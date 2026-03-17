import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Sale } from './entities/sale.entity';
import { SaleItem } from './entities/sale-item.entity';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { CreateSaleDto, SaleItemInputDto } from './dto/create-sale.dto';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { TransactionType } from '../cash-register/entities/transaction.entity';

// ─────────────────────────────────────────────────────────────────────────────
//  PRECIO HISTÓRICO — por qué se congela en SaleItem.unitPrice
// ─────────────────────────────────────────────────────────────────────────────
//
//  Escenario problemático sin snapshot:
//    Enero: Agua 500ml se vendía a $300.
//    Febrero: Admin sube el precio a $400.
//    Si los reportes de Enero leen product.salePrice, verían $400 → número incorrecto.
//
//  Solución: al momento del SELECT FOR UPDATE, leemos product.salePrice
//  y lo escribimos en sale_item.unit_price. Esa columna NUNCA se actualiza.
//
//  Consecuencia: los reportes históricos siempre son precisos porque
//  no dependen del estado actual del producto, sino del valor en el momento
//  exacto de la transacción.
//
//  Lo mismo aplica a BookingItem.unitPrice en el módulo de Agenda (Fase 3).
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(Sale)
    private readonly saleRepo: Repository<Sale>,

    private readonly cashRegisterService: CashRegisterService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  //  GET: Historial de ventas del día
  // ───────────────────────────────────────────────────────────────────────────

  async findByDate(date: string): Promise<Sale[]> {
    return this.saleRepo
      .createQueryBuilder('sale')
      .leftJoinAndSelect('sale.items', 'items')
      .leftJoinAndSelect('items.product', 'product')
      .leftJoinAndSelect('sale.createdByUser', 'user')
      .where(`DATE(sale.createdAt AT TIME ZONE 'America/Argentina/Buenos_Aires') = :date`, { date })
      .orderBy('sale.createdAt', 'DESC')
      .getMany();
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  POST: Crear venta — TRANSACCIÓN COMPLETA
  // ───────────────────────────────────────────────────────────────────────────

  async create(dto: CreateSaleDto, user: User, idempotencyKey?: string): Promise<Sale> {
    // ── GUARDIA DE IDEMPOTENCIA ───────────────────────────────────────────────
    // Si el frontend ya envió esta clave antes (mismo intento de venta),
    // retornamos la venta existente sin tocar stock ni caja.
    // Protege contra: doble-clic residual, retry por red lenta, reenvío del browser.
    if (idempotencyKey) {
      const existing = await this.saleRepo.findOne({
        where: { idempotencyKey },
        relations: ['items', 'items.product', 'createdByUser'],
      });
      if (existing) {
        this.logger.log(
          `Venta duplicada detectada (idempotency-key: ${idempotencyKey}) → retornando venta existente ${existing.id}`,
        );
        return existing;
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // ── PASO 1: Resolver items con bloqueo y snapshot de precio ───────────
      const resolvedItems = await this.resolveItemsWithLock(dto.items, queryRunner);

      // ── PASO 2: Calcular total de la venta ───────────────────────────────
      const total = resolvedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

      const amountCash = dto.amountCash ?? 0;
      const amountTransfer = dto.amountTransfer ?? 0;
      const totalPaid = amountCash + amountTransfer;

      // Validación de pago: el cobrado debe cubrir el total
      if (totalPaid < total) {
        throw new BadRequestException(
          `Pago insuficiente. Total: $${total.toLocaleString('es-AR')}, ` +
            `cobrado: $${totalPaid.toLocaleString('es-AR')}. ` +
            `Diferencia: $${(total - totalPaid).toLocaleString('es-AR')}.`,
        );
      }

      // ── PASO 3: Obtener/crear sesión de caja activa ───────────────────────
      //
      // getOrCreateActiveSession crea la sesión del día si es la primera
      // operación, o retorna la existente. Si la caja está CERRADA lanza
      // ServiceUnavailableException → ROLLBACK automático de toda la venta.
      //
      const session = await this.cashRegisterService.getOrCreateActiveSession(queryRunner, user.id);

      // ── PASO 4: Crear el registro de venta con sesión de caja ─────────────
      const sale = queryRunner.manager.create(Sale, {
        createdByUserId: user.id,
        amountCash,
        amountTransfer,
        total,
        cashSessionId: session.id,
        idempotencyKey: idempotencyKey ?? null,
        customerName: dto.customerName?.trim() || null,
      });

      const savedSale = await queryRunner.manager.save(Sale, sale);

      // ── PASO 5: Crear SaleItems con precio histórico congelado ────────────
      //
      // resolvedItems ya contiene unitPrice = product.salePrice en el
      // momento exacto de la transacción (snapshot). Ver comentario superior.
      //
      const saleItems = resolvedItems.map((item) =>
        queryRunner.manager.create(SaleItem, {
          saleId: savedSale.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice, // ← PRECIO CONGELADO (snapshot)
        }),
      );

      await queryRunner.manager.save(SaleItem, saleItems);

      // ── PASO 6: Decrementar stock (atómico dentro de la transacción) ──────
      for (const item of resolvedItems) {
        await queryRunner.manager.decrement(
          Product,
          { id: item.productId },
          'stock',
          item.quantity,
        );
      }

      // ── PASO 7: Registrar movimiento en caja ──────────────────────────────
      //
      // Dentro del mismo queryRunner → si falla, toda la venta hace ROLLBACK.
      // Nunca queda una Sale sin su correspondiente Transaction en caja.
      //
      await this.cashRegisterService.registerTransaction(queryRunner, {
        cashSessionId: session.id,
        type: TransactionType.SALE,
        referenceId: savedSale.id,
        concept: `Venta mostrador - ${resolvedItems.length} producto(s)`,
        amountCash,
        amountTransfer,
        createdByUserId: user.id,
      });

      // ── COMMIT ────────────────────────────────────────────────────────────
      await queryRunner.commitTransaction();

      this.logger.log(
        `Venta confirmada: $${total.toLocaleString('es-AR')} ` +
          `(${resolvedItems.length} productos, efectivo: $${amountCash}, ` +
          `transferencia: $${amountTransfer}) por ${user.username}`,
      );

      // Retornar la venta con sus relaciones completas
      return this.findOneWithDetails(savedSale.id);
    } catch (error) {
      // Envolver el rollback en su propio try/catch:
      // Si PostgreSQL ya abortó la transacción internamente (ej: constraint
      // violation), TypeORM puede lanzar "There is no active transaction" al
      // intentar hacer ROLLBACK. Sin este try/catch, esa excepción secundaria
      // escapa del catch principal y NestJS devuelve un 500 ciego que oculta
      // el error real.
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        this.logger.error(
          'Error al intentar ROLLBACK (transacción ya abortada por DB):',
          rollbackError,
        );
      }

      // Imprimir el error ORIGINAL completo (con stack trace) para que no sea
      // un 500 ciego. Visible en los logs del servidor y en la consola de dev.
      console.error('[POS] Error original en create():', error);
      this.logger.error(`ROLLBACK en venta POS: ${error.message}`, error.stack);

      this.handleDbError(error);
    } finally {
      await queryRunner.release();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  PRIVADOS
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Núcleo del POS: por cada item del carrito...
   *
   * 1. Hace SELECT FOR UPDATE en el producto → bloqueo exclusivo.
   *    Ninguna otra transacción concurrente puede leer ni modificar
   *    el stock de ese producto hasta el COMMIT.
   *
   * 2. Verifica que haya stock suficiente. Si no → BadRequest + ROLLBACK.
   *
   * 3. Captura el precio de venta en ese instante exacto (snapshot).
   *    Este valor se escribirá en sale_item.unit_price y nunca cambiará.
   *
   * Retorna los items enriquecidos con unitPrice y nombre del producto.
   */
  private async resolveItemsWithLock(
    items: SaleItemInputDto[],
    queryRunner: any,
  ): Promise<
    {
      productId: string;
      productName: string;
      quantity: number;
      unitPrice: number;
    }[]
  > {
    // Verificar duplicados en el carrito (mismo producto dos veces)
    const productIds = items.map((i) => i.productId);
    const uniqueIds = new Set(productIds);
    if (uniqueIds.size !== productIds.length) {
      throw new BadRequestException(
        'El carrito contiene el mismo producto más de una vez. ' +
          'Consolidá las cantidades en un solo item.',
      );
    }

    const resolved: {
      productId: string;
      productName: string;
      quantity: number;
      unitPrice: number;
    }[] = [];

    for (const item of items) {
      // ── SELECT FOR UPDATE ─────────────────────────────────────────────────
      //
      // El lock se libera automáticamente con el COMMIT/ROLLBACK del
      // queryRunner padre. Dos ventas concurrentes del mismo producto
      // se serializan aquí: la segunda espera, luego ve el stock ya
      // decrementado por la primera y puede fallar si el stock se agotó.
      //
      // IMPORTANTE: loadEagerRelations: false es obligatorio aquí.
      // Product.category tiene { eager: true, nullable: true }, lo que hace
      // que TypeORM genere un LEFT JOIN automático. PostgreSQL prohíbe aplicar
      // FOR UPDATE al lado nullable de un outer join y lanza:
      //   "FOR UPDATE cannot be applied to the nullable side of an outer join"
      // Al deshabilitar eager loading, la query queda como un SELECT simple
      // sobre la tabla products sin joins, y el lock funciona correctamente.
      const product = await queryRunner.manager.findOne(Product, {
        where: { id: item.productId, isActive: true },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });

      if (!product) {
        throw new NotFoundException(
          `Producto con ID "${item.productId}" no encontrado o inactivo.`,
        );
      }

      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Stock insuficiente para "${product.name}". ` +
            `Disponible: ${product.stock} unidad(es), solicitado: ${item.quantity}.`,
        );
      }

      // ── SNAPSHOT DE PRECIO ────────────────────────────────────────────────
      //
      // product.salePrice es el precio en este INSTANTE de tiempo.
      // Se copia a unitPrice antes del COMMIT. A partir de aquí,
      // aunque el admin cambie el precio del producto mañana,
      // esta venta siempre reflejará el precio de hoy.
      //
      resolved.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: Number(product.salePrice), // ← SNAPSHOT INMUTABLE
      });
    }

    return resolved;
  }

  async findOneWithDetails(id: string): Promise<Sale> {
    const sale = await this.saleRepo.findOne({
      where: { id },
      relations: ['items', 'items.product', 'createdByUser'],
    });
    if (!sale) throw new NotFoundException(`Sale ${id} not found`);
    return sale;
  }

  private handleDbError(error: any): never {
    // Check constraint: stock quedó negativo (segunda red de seguridad)
    if (error?.code === '23514') {
      throw new BadRequestException('Stock insuficiente detectado por la base de datos.');
    }

    if (error?.getStatus) {
      throw error;
    }

    this.logger.error('Error inesperado en POS:', error);
    throw new InternalServerErrorException(
      'Error interno al procesar la venta. Intente nuevamente.',
    );
  }
}
