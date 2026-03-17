import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { Booking, BookingStatus, PriceType } from './entities/booking.entity';
import { BookingItem } from './entities/booking-item.entity';
import { BookingPayment } from './entities/booking-payment.entity';
import { Product } from '../products/entities/product.entity';
import { Court } from '../courts/entities/court.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { SystemConfigService } from '../system-config/system-config.service';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { TransactionType } from '../cash-register/entities/transaction.entity';

import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { QueryBookingsDto } from './dto/query-bookings.dto';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,

    private readonly systemConfigService: SystemConfigService,
    private readonly cashRegisterService: CashRegisterService,
  ) {}

  /** Retorna los turnos de una fecha, opcionalmente filtrados por cancha. */
  async findByDate(query: QueryBookingsDto): Promise<Booking[]> {
    const qb = this.bookingRepo
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.court', 'court')
      .leftJoinAndSelect('booking.items', 'items')
      .leftJoinAndSelect('items.product', 'product')
      .leftJoinAndSelect('booking.payment', 'payment')
      .leftJoinAndSelect('booking.createdByUser', 'user')
      .where('booking.date = :date', { date: query.date })
      .andWhere('booking.status != :cancelled', {
        cancelled: BookingStatus.CANCELLED,
      })
      .orderBy('booking.hour', 'ASC')
      .addOrderBy('court.name', 'ASC');

    if (query.courtId) {
      qb.andWhere('booking.courtId = :courtId', { courtId: query.courtId });
    }

    return qb.getMany();
  }

  /** Retorna un turno por ID con todas sus relaciones. */
  async findOne(id: string): Promise<Booking> {
    const booking = await this.bookingRepo.findOne({
      where: { id },
      relations: ['court', 'items', 'items.product', 'payment', 'createdByUser'],
    });

    if (!booking) {
      throw new NotFoundException(`Turno con ID ${id} no encontrado.`);
    }

    return booking;
  }

  /**
   * Crea un turno en una transacción atómica.
   * Usa advisory lock de PostgreSQL + constraint UNIQUE para prevenir overbooking.
   */
  async create(dto: CreateBookingDto, user: User): Promise<Booking> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const slotKey = `${dto.courtId}:${dto.date}:${dto.hour}`;
      await queryRunner.query(`SELECT pg_advisory_xact_lock(abs(hashtext($1)))`, [slotKey]);

      const court = await queryRunner.manager.findOne(Court, {
        where: { id: dto.courtId, isActive: true },
      });

      if (!court) {
        throw new NotFoundException(`Cancha con ID ${dto.courtId} no encontrada o inactiva.`);
      }

      const [newH, newM] = dto.hour.split(':').map(Number);
      const newStartMin = newH * 60 + newM;
      const newEndMin = newStartMin + (dto.durationMinutes ?? 60);

      const overlappingBooking = await queryRunner.manager
        .createQueryBuilder(Booking, 'b')
        .setLock('pessimistic_write')
        .where('b.court_id = :courtId', { courtId: dto.courtId })
        .andWhere('b.date = :date', { date: dto.date })
        .andWhere('b.status != :cancelled', { cancelled: BookingStatus.CANCELLED })
        .andWhere(
          `(CAST(SPLIT_PART(b.hour, ':', 1) AS INTEGER) * 60
            + CAST(SPLIT_PART(b.hour, ':', 2) AS INTEGER)) < :newEnd`,
          { newEnd: newEndMin },
        )
        .andWhere(
          `:newStart < (CAST(SPLIT_PART(b.hour, ':', 1) AS INTEGER) * 60
              + CAST(SPLIT_PART(b.hour, ':', 2) AS INTEGER) + b.duration_minutes)`,
          { newStart: newStartMin },
        )
        .getOne();

      if (overlappingBooking) {
        throw new ConflictException(
          `El slot ${court.name} - ${dto.hour}hs del ${dto.date} se solapa con ` +
            `el turno de ${overlappingBooking.clientName} (${overlappingBooking.hour}hs, ` +
            `${overlappingBooking.durationMinutes} min).`,
        );
      }

      const prices = await this.systemConfigService.getPrices();
      const priceType = dto.priceType ?? PriceType.STANDARD;
      const priceAmount = priceType === PriceType.PROFESSOR ? prices.professor : prices.standard;

      const bookingItems = await this.processItems(dto.items ?? [], queryRunner);

      const booking = queryRunner.manager.create(Booking, {
        courtId: dto.courtId,
        date: dto.date,
        hour: dto.hour,
        clientName: dto.clientName,
        status: BookingStatus.BOOKED,
        priceType,
        priceAmount,
        durationMinutes: dto.durationMinutes ?? 60,
        createdByUserId: user.id,
      });

      const savedBooking = await queryRunner.manager.save(Booking, booking);

      if (bookingItems.length > 0) {
        const items = bookingItems.map((item) =>
          queryRunner.manager.create(BookingItem, {
            bookingId: savedBooking.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          }),
        );
        await queryRunner.manager.save(BookingItem, items);
      }

      const amountCash = dto.amountCash ?? 0;
      const amountTransfer = dto.amountTransfer ?? 0;

      const payment = queryRunner.manager.create(BookingPayment, {
        bookingId: savedBooking.id,
        amountCash,
        amountTransfer,
      });
      await queryRunner.manager.save(BookingPayment, payment);

      const totalPaid = (dto.amountCash ?? 0) + (dto.amountTransfer ?? 0);
      if (totalPaid > 0) {
        const session = await this.cashRegisterService.getOrCreateActiveSession(
          queryRunner,
          user.id,
        );

        await this.cashRegisterService.registerTransaction(queryRunner, {
          cashSessionId: session.id,
          type: TransactionType.BOOKING,
          referenceId: savedBooking.id,
          concept: `Turno ${court.name} - ${dto.hour}hs (${dto.clientName})`,
          amountCash: dto.amountCash ?? 0,
          amountTransfer: dto.amountTransfer ?? 0,
          createdByUserId: user.id,
        });
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `Turno creado: ${court.name} ${dto.date} ${dto.hour}hs → ${dto.clientName} (por ${user.username})`,
      );

      return this.findOne(savedBooking.id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.warn(`ROLLBACK en creación de turno: ${error.message}`);
      this.handleDbError(error);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Actualiza un turno: estado, cliente, items de buffet y pago.
   * Valida la máquina de estados antes de aplicar cambios.
   */
  async update(id: string, dto: UpdateBookingDto, user: User): Promise<Booking> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const booking = await queryRunner.manager.findOne(Booking, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!booking) {
        throw new NotFoundException(`Turno con ID ${id} no encontrado.`);
      }

      const bookingWithRelations = await queryRunner.manager.findOne(Booking, {
        where: { id },
        relations: ['items', 'payment'],
      });

      if (dto.status && booking.status === dto.status) {
        await queryRunner.rollbackTransaction();
        this.logger.log(
          `Turno ${id} ya está en estado "${dto.status}" — respuesta idempotente sin cambios.`,
        );
        return this.findOne(id);
      }

      if (dto.status) {
        this.validateStatusTransition(booking.status, dto.status, user);
      }

      let itemsTotal = 0;

      if (dto.items !== undefined) {
        const existingItems = bookingWithRelations?.items ?? [];

        await this.restoreStock(existingItems, queryRunner);

        if (existingItems.length > 0) {
          const ids = existingItems.map((i) => i.id);
          const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(', ');
          await queryRunner.query(`DELETE FROM booking_items WHERE id IN (${placeholders})`, ids);
        }

        const newItems = await this.processItems(dto.items, queryRunner);
        itemsTotal = newItems.reduce((sum, i) => sum + Number(i.unitPrice) * i.quantity, 0);

        for (const item of newItems) {
          await queryRunner.query(
            `INSERT INTO booking_items (booking_id, product_id, quantity, unit_price)
             VALUES ($1, $2, $3, $4)`,
            [booking.id, item.productId, item.quantity, item.unitPrice],
          );
        }
      } else {
        itemsTotal = (bookingWithRelations?.items ?? []).reduce(
          (sum, i) => sum + Number(i.unitPrice) * i.quantity,
          0,
        );
      }

      if (dto.status === BookingStatus.COMPLETED) {
        const existingPayment = bookingWithRelations?.payment;
        const effectiveCash =
          dto.amountCash !== undefined ? dto.amountCash : Number(existingPayment?.amountCash ?? 0);
        const effectiveTransfer =
          dto.amountTransfer !== undefined
            ? dto.amountTransfer
            : Number(existingPayment?.amountTransfer ?? 0);

        const totalPaid = effectiveCash + effectiveTransfer;
        const totalRequired = Number(booking.priceAmount) + itemsTotal;

        if (totalPaid < totalRequired) {
          throw new BadRequestException(
            'No se puede completar un turno con saldo pendiente. ' +
              `Pagado: $${totalPaid}, Requerido: $${totalRequired} ` +
              `(cancha $${booking.priceAmount} + consumos $${itemsTotal}).`,
          );
        }
      }

      const hasPaymentUpdate = dto.amountCash !== undefined || dto.amountTransfer !== undefined;

      if (hasPaymentUpdate) {
        if (bookingWithRelations?.payment) {
          const paymentFields: Partial<BookingPayment> = {};
          if (dto.amountCash !== undefined) paymentFields.amountCash = dto.amountCash;
          if (dto.amountTransfer !== undefined) paymentFields.amountTransfer = dto.amountTransfer;
          await queryRunner.manager.update(
            BookingPayment,
            bookingWithRelations.payment.id,
            paymentFields,
          );
        } else {
          await queryRunner.query(
            `INSERT INTO booking_payments (booking_id, amount_cash, amount_transfer)
             VALUES ($1, $2, $3)`,
            [booking.id, dto.amountCash ?? 0, dto.amountTransfer ?? 0],
          );
        }
      }

      const bookingFields: Partial<Booking> = {};
      if (dto.clientName) bookingFields.clientName = dto.clientName;
      if (dto.status) bookingFields.status = dto.status;

      if (Object.keys(bookingFields).length > 0) {
        await queryRunner.manager.update(Booking, { id: booking.id }, bookingFields);
      }

      await queryRunner.commitTransaction();
      this.logger.log(
        `Turno ${id} actualizado por ${user.username}` +
          (dto.status ? ` → estado: ${dto.status}` : ''),
      );

      return this.findOne(id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`ROLLBACK en actualización de turno ${id}: ${error.message}`, error.stack);
      this.handleDbError(error);
    } finally {
      await queryRunner.release();
    }
  }

  /** Cancela un turno (solo admin) y restaura el stock de los productos consumidos. */
  async cancel(id: string, user: User): Promise<void> {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Solo los administradores pueden cancelar turnos.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const booking = await queryRunner.manager.findOne(Booking, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!booking) {
        throw new NotFoundException(`Turno con ID ${id} no encontrado.`);
      }

      if (booking.status === BookingStatus.CANCELLED) {
        throw new BadRequestException('El turno ya está cancelado.');
      }

      const bookingWithItems = await queryRunner.manager.findOne(Booking, {
        where: { id },
        relations: ['items'],
      });

      await this.restoreStock(bookingWithItems?.items ?? [], queryRunner);

      await queryRunner.manager.update(
        Booking,
        { id: booking.id },
        { status: BookingStatus.CANCELLED },
      );

      await queryRunner.commitTransaction();
      this.logger.log(
        `Turno ${id} cancelado por admin ${user.username}. Stock restaurado para ${bookingWithItems?.items?.length ?? 0} productos.`,
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.handleDbError(error);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Bloquea cada producto con SELECT FOR UPDATE, verifica stock y descuenta la cantidad.
   * Retorna los items enriquecidos con el precio snapshot del momento.
   */
  private async processItems(
    items: { productId: string; quantity: number }[],
    queryRunner: any,
  ): Promise<{ productId: string; quantity: number; unitPrice: number }[]> {
    const result: { productId: string; quantity: number; unitPrice: number }[] = [];

    for (const item of items) {
      const product = await queryRunner.manager.findOne(Product, {
        where: { id: item.productId, isActive: true },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });

      if (!product) {
        throw new NotFoundException(`Producto con ID ${item.productId} no encontrado o inactivo.`);
      }

      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Stock insuficiente para "${product.name}". ` +
            `Disponible: ${product.stock}, solicitado: ${item.quantity}.`,
        );
      }

      await queryRunner.manager.decrement(Product, { id: product.id }, 'stock', item.quantity);

      result.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: Number(product.salePrice),
      });
    }

    return result;
  }

  /** Incrementa el stock de cada item al cancelar un turno o reemplazar sus productos. */
  private async restoreStock(items: BookingItem[], queryRunner: any): Promise<void> {
    for (const item of items) {
      await queryRunner.manager.increment(Product, { id: item.productId }, 'stock', item.quantity);
    }

    if (items.length > 0) {
      this.logger.debug(`Stock restaurado para ${items.length} productos del turno.`);
    }
  }

  /**
   * Valida que la transición de estado sea permitida.
   * BOOKED → PLAYING → COMPLETED. Solo admin puede cancelar.
   */
  private validateStatusTransition(current: BookingStatus, next: BookingStatus, user: User): void {
    const TERMINAL_STATES = [BookingStatus.COMPLETED, BookingStatus.CANCELLED];

    if (TERMINAL_STATES.includes(current)) {
      throw new BadRequestException(`No se puede cambiar el estado de un turno ${current}.`);
    }

    if (next === BookingStatus.CANCELLED && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Solo los administradores pueden cancelar turnos.');
    }

    const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
      [BookingStatus.BOOKED]: [BookingStatus.PLAYING, BookingStatus.CANCELLED],
      [BookingStatus.PLAYING]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
      [BookingStatus.COMPLETED]: [],
      [BookingStatus.CANCELLED]: [],
    };

    if (!VALID_TRANSITIONS[current].includes(next)) {
      throw new BadRequestException(
        `Transición inválida: ${current} → ${next}. ` +
          `Transiciones válidas desde ${current}: [${VALID_TRANSITIONS[current].join(', ')}].`,
      );
    }
  }

  /** Convierte errores de base de datos en excepciones HTTP apropiadas. */
  private handleDbError(error: any): never {
    if (error?.code === '23505') {
      throw new ConflictException(
        'Ese horario ya fue reservado por otro usuario. Por favor recargue la agenda.',
      );
    }

    if (error?.code === '23514') {
      throw new BadRequestException('Operación inválida: se intentó dejar stock negativo.');
    }

    if (error?.getStatus) {
      throw error;
    }

    this.logger.error('Error de base de datos no controlado:', error);
    this.logger.error('Stack:', error?.stack);
    throw new InternalServerErrorException(
      `Error interno: ${error?.message ?? 'desconocido'} (code: ${error?.code ?? 'n/a'})`,
    );
  }
}
