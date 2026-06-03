import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Brackets, FindOptionsWhere } from 'typeorm';
import { UserRole } from '../users/entities/user.entity';

import {
  InternalConsumption,
  InternalConsumptionStatus,
  InternalConsumptionConsumerType,
} from './entities/internal-consumption.entity';
import { CreateInternalConsumptionDto } from './dto/create-internal-consumption.dto';
import { QueryInternalConsumptionDto } from './dto/query-internal-consumption.dto';
import { SettleTeacherDebtDto, PaymentMethod } from './dto/settle-teacher-debt.dto';
import { ProductsService } from '../products/products.service';
import { Product } from '../products/entities/product.entity';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { Transaction, TransactionType } from '../cash-register/entities/transaction.entity';

@Injectable()
export class InternalConsumptionService {
  private readonly logger = new Logger(InternalConsumptionService.name);

  constructor(
    @InjectRepository(InternalConsumption)
    private readonly repo: Repository<InternalConsumption>,

    private readonly productsService: ProductsService,
    private readonly dataSource: DataSource,
    private readonly cashRegisterService: CashRegisterService,
  ) {}

  /**
   * Create a consumption record and decrement product stock atomically.
   * Staff → status: staff_consumption (no debt).
   * Teacher → status: pending_payment (generates debt).
   */
  async create(
    dto: CreateInternalConsumptionDto,
    createdByUserId: string,
  ): Promise<InternalConsumption> {
    const product = await this.productsService.findOne(dto.productId);

    if (product.stock < dto.quantity) {
      throw new BadRequestException(
        `Stock insuficiente para "${product.name}". Disponible: ${product.stock}, solicitado: ${dto.quantity}.`,
      );
    }

    const status =
      dto.consumerType === InternalConsumptionConsumerType.STAFF
        ? InternalConsumptionStatus.STAFF_CONSUMPTION
        : InternalConsumptionStatus.PENDING_PAYMENT;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      product.stock -= Number(dto.quantity);
      await queryRunner.manager.save(Product, product);

      const consumption = queryRunner.manager.create(InternalConsumption, {
        productId: dto.productId,
        quantity: dto.quantity,
        consumerType: dto.consumerType,
        userId: dto.userId ?? null,
        teacherId: dto.teacherId ?? null,
        status,
        notes: dto.notes ?? null,
        unitCostPrice: product.salePrice,
        date: dto.date,
        createdByUserId,
      });

      const saved = await queryRunner.manager.save(InternalConsumption, consumption);
      await queryRunner.commitTransaction();

      this.logger.log(
        `Consumo interno registrado: "${product.name}" x${dto.quantity} — ${status} (id: ${saved.id})`,
      );

      return this.findOne(saved.id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`ROLLBACK en consumo interno: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /** List consumptions with optional filters. */
  async findAll(
    query: QueryInternalConsumptionDto,
    requestingUser: { id: string; role: UserRole },
  ): Promise<InternalConsumption[]> {
    const qb = this.repo
      .createQueryBuilder('ic')
      .leftJoinAndSelect('ic.product', 'product')
      .leftJoinAndSelect('ic.user', 'user')
      .leftJoinAndSelect('ic.teacher', 'teacher')
      .leftJoinAndSelect('ic.createdByUser', 'createdByUser');

    if (requestingUser.role === UserRole.EMPLOYEE) {
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('ic.consumerType = :teacherType', { teacherType: InternalConsumptionConsumerType.TEACHER })
            .orWhere('ic.consumerType = :staffType AND ic.user_id = :userId', {
              staffType: InternalConsumptionConsumerType.STAFF,
              userId: requestingUser.id,
            });
        }),
      );
    }

    if (query.status) qb.andWhere('ic.status = :status', { status: query.status });
    if (query.consumerType) qb.andWhere('ic.consumerType = :consumerType', { consumerType: query.consumerType });
    if (query.teacherId) qb.andWhere('ic.teacher_id = :teacherId', { teacherId: query.teacherId });
    if (query.userId) qb.andWhere('ic.user_id = :userId', { userId: query.userId });
    if (query.dateFrom && query.dateTo) {
      qb.andWhere('ic.date BETWEEN :dateFrom AND :dateTo', { dateFrom: query.dateFrom, dateTo: query.dateTo });
    }

    return qb.orderBy('ic.createdAt', 'DESC').getMany();
  }

  /** Find single consumption or throw. */
  async findOne(id: string): Promise<InternalConsumption> {
    const record = await this.repo.findOne({
      where: { id },
      relations: ['product', 'user', 'teacher', 'createdByUser'],
    });
    if (!record) throw new NotFoundException(`Consumo interno #${id} no encontrado.`);
    return record;
  }

  /**
   * Settle all pending_payment records for a teacher (or specific IDs).
   * Transitions: pending_payment → paid.
   * Requires an open cash session. Inserts a Transaction for the arqueo.
   */
  async settleTeacherDebt(
    dto: SettleTeacherDebtDto,
    userId: string,
  ): Promise<InternalConsumption[]> {
    const where: FindOptionsWhere<InternalConsumption> = {
      teacherId: dto.teacherId,
      status: InternalConsumptionStatus.PENDING_PAYMENT,
    };

    const pending = await this.repo.find({ where, relations: ['teacher'] });

    if (pending.length === 0) {
      throw new NotFoundException(`No hay consumos pendientes para el profesor #${dto.teacherId}.`);
    }

    let toSettle = pending;

    if (dto.consumptionIds && dto.consumptionIds.length > 0) {
      toSettle = pending.filter((c) => dto.consumptionIds!.includes(c.id));
      if (toSettle.length === 0) {
        throw new BadRequestException(
          'Ninguno de los IDs provistos corresponde a consumos pendientes del profesor.',
        );
      }
    }

    const totalAmount = toSettle.reduce((sum, c) => sum + Number(c.unitCostPrice) * c.quantity, 0);

    const teacherName = toSettle[0]?.teacher?.fullName ?? `Profesor #${dto.teacherId.slice(0, 8)}`;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const session = await this.cashRegisterService.getActiveSessionOrFail(qr, userId);

      await qr.manager.update(
        InternalConsumption,
        toSettle.map((c) => c.id),
        {
          status: InternalConsumptionStatus.PAID,
          notes: dto.notes ?? undefined,
        },
      );

      const tx = qr.manager.create(Transaction, {
        cashSessionId: session.id,
        type: TransactionType.SETTLEMENT,
        referenceId: dto.teacherId,
        concept: `Liquidación Consumos - ${teacherName}`,
        amountCash: dto.paymentMethod === PaymentMethod.CASH ? totalAmount : 0,
        amountTransfer: dto.paymentMethod === PaymentMethod.TRANSFER ? totalAmount : 0,
        createdByUserId: userId,
      });
      await qr.manager.save(Transaction, tx);

      await qr.commitTransaction();

      this.logger.log(
        `Deuda liquidada: ${toSettle.length} consumo(s) de ${teacherName} — $${totalAmount} (${dto.paymentMethod}). Sesión: ${session.id}.`,
      );
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }

    return this.repo.findBy(toSettle.map((c) => ({ id: c.id })));
  }

  /** Summary of pending debt per teacher. */
  async teacherDebtSummary(): Promise<
    { teacherId: string; totalItems: number; totalCost: number }[]
  > {
    const rows = await this.repo
      .createQueryBuilder('ic')
      .select('ic.teacher_id', 'teacherId')
      .addSelect('COUNT(*)', 'totalItems')
      .addSelect('SUM(ic.unit_cost_price * ic.quantity)', 'totalCost')
      .where('ic.status = :status', { status: InternalConsumptionStatus.PENDING_PAYMENT })
      .groupBy('ic.teacher_id')
      .getRawMany();

    return rows.map((r) => ({
      teacherId: r.teacherId,
      totalItems: Number(r.totalItems),
      totalCost: Number(r.totalCost),
    }));
  }
}
