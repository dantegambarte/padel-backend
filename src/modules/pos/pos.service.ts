import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Sale } from './entities/sale.entity';
import { SaleItem } from './entities/sale-item.entity';
import { Product } from '../products/entities/product.entity';
import { ProductCategory } from '../products/entities/product-category.entity';
import { User } from '../users/entities/user.entity';
import { CreateSaleDto, SaleItemInputDto } from './dto/create-sale.dto';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { TransactionType } from '../cash-register/entities/transaction.entity';

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

  /** Retorna las ventas de una fecha filtradas por zona horaria Argentina. */
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

  /**
   * Crea una venta en una transacción atómica.
   * Si se provee idempotencyKey y ya existe, retorna la venta existente sin modificar stock.
   */
  async create(dto: CreateSaleDto, user: User, idempotencyKey?: string): Promise<Sale> {
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
      const resolvedItems = await this.resolveItemsWithLock(dto.items, queryRunner);

      const total = resolvedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

      const amountCash = dto.amountCash ?? 0;
      const amountTransfer = dto.amountTransfer ?? 0;
      const totalPaid = amountCash + amountTransfer;

      if (totalPaid < total) {
        throw new BadRequestException(
          `Pago insuficiente. Total: $${total.toLocaleString('es-AR')}, ` +
            `cobrado: $${totalPaid.toLocaleString('es-AR')}. ` +
            `Diferencia: $${(total - totalPaid).toLocaleString('es-AR')}.`,
        );
      }

      const session = await this.cashRegisterService.getActiveSessionOrFail(queryRunner, user.id);

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

      const saleItems = resolvedItems.map((item) =>
        queryRunner.manager.create(SaleItem, {
          saleId: savedSale.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        }),
      );

      await queryRunner.manager.save(SaleItem, saleItems);

      for (const item of resolvedItems) {
        if (!item.isRental) {
          await queryRunner.manager.decrement(
            Product,
            { id: item.productId },
            'stock',
            item.quantity,
          );
        }
      }

      await this.cashRegisterService.registerTransaction(queryRunner, {
        cashSessionId: session.id,
        type: TransactionType.SALE,
        referenceId: savedSale.id,
        concept: `Venta cantina - ${resolvedItems.length} producto(s)`,
        amountCash,
        amountTransfer,
        createdByUserId: user.id,
      });

      await queryRunner.commitTransaction();

      this.logger.log(
        `Venta confirmada: $${total.toLocaleString('es-AR')} ` +
          `(${resolvedItems.length} productos, efectivo: $${amountCash}, ` +
          `transferencia: $${amountTransfer}) por ${user.username}`,
      );

      return this.findOneWithDetails(savedSale.id);
    } catch (error) {
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        this.logger.error(
          'Error al intentar ROLLBACK (transacción ya abortada por DB):',
          rollbackError,
        );
      }

      console.error('[POS] Error original en create():', error);
      this.logger.error(`ROLLBACK en venta POS: ${error.message}`, error.stack);

      this.handleDbError(error);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Devuelve `true` si la categoría es de alquiler (servicio sin stock finito).
   * Usa el campo `isRental` de la entidad como fuente de verdad.
   * Fallback: coincidencia exacta con "alquileres" para categorías anteriores a la migración.
   */
  private isCategoryRental(category: ProductCategory | null): boolean {
    if (!category) return false;
    if (category.isRental) return true;
    return category.name.trim().toLowerCase() === 'alquileres';
  }

  /**
   * Bloquea cada producto con SELECT FOR UPDATE **sin joins** para respetar la restricción
   * de PostgreSQL que prohíbe FOR UPDATE en el lado nullable de un outer join (error 0A000).
   * La categoría se carga en una consulta separada sin lock.
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
      isRental: boolean;
    }[]
  > {
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
      isRental: boolean;
    }[] = [];

    for (const item of items) {
      // Paso 1: bloquear la fila del producto SIN joins (FOR UPDATE + LEFT JOIN no es válido en PG)
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

      // Paso 2: cargar la categoría sin lock solo para el chequeo de alquiler
      const category = product.categoryId
        ? await queryRunner.manager.findOne(ProductCategory, {
            where: { id: product.categoryId },
          })
        : null;

      const rental = this.isCategoryRental(category);

      if (!rental && product.stock < item.quantity) {
        throw new ConflictException(
          `Stock insuficiente para "${product.name}". ` +
            `Disponible: ${product.stock} unidad(es), solicitado: ${item.quantity}.`,
        );
      }

      resolved.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: Number(product.salePrice),
        isRental: rental,
      });
    }

    return resolved;
  }

  /** Retorna una venta por ID con todos sus items y relaciones. */
  async findOneWithDetails(id: string): Promise<Sale> {
    const sale = await this.saleRepo.findOne({
      where: { id },
      relations: ['items', 'items.product', 'createdByUser'],
    });
    if (!sale) throw new NotFoundException(`Sale ${id} not found`);
    return sale;
  }

  /** Convierte errores de base de datos en excepciones HTTP apropiadas. */
  private handleDbError(error: any): never {
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
