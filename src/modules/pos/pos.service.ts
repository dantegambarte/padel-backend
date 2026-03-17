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

      const session = await this.cashRegisterService.getOrCreateActiveSession(queryRunner, user.id);

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
        await queryRunner.manager.decrement(
          Product,
          { id: item.productId },
          'stock',
          item.quantity,
        );
      }

      await this.cashRegisterService.registerTransaction(queryRunner, {
        cashSessionId: session.id,
        type: TransactionType.SALE,
        referenceId: savedSale.id,
        concept: `Venta mostrador - ${resolvedItems.length} producto(s)`,
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
   * Bloquea cada producto con SELECT FOR UPDATE, valida stock
   * y captura el precio snapshot del momento de la transacción.
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

      resolved.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: Number(product.salePrice),
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
