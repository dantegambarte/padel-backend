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
import { DataSource, In, IsNull, Repository } from 'typeorm';

import { Booking, BookingStatus, PriceType } from './entities/booking.entity';
import { BookingItem } from './entities/booking-item.entity';
import { BookingPayment } from './entities/booking-payment.entity';
import { Product } from '../products/entities/product.entity';
import { ProductCategory } from '../products/entities/product-category.entity';
import { Court } from '../courts/entities/court.entity';
import { PricingShift } from '../pricing-shifts/entities/pricing-shift.entity';
import { User, UserRole } from '../users/entities/user.entity';
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

    private readonly cashRegisterService: CashRegisterService,
  ) {}

  /**
   * Retorna los turnos con seña recurrente pendiente de confirmación.
   *
   * Condiciones:
   * - expectedDepositAmount IS NOT NULL AND > 0
   * - Estado distinto de CANCELLED y COMPLETED
   * - Fecha >= hoy (no muestra turnos pasados sin confirmar para no saturar)
   * - El pago existente (si lo hay) no cubre el monto esperado
   *
   * Usado por el panel de alertas del header.
   */
  /**
   * Retorna los turnos con seña recurrente pendiente de confirmación.
   *
   * @param daysAhead  0 = solo hoy (default). 1 = hoy + mañana. N = ventana de N días.
   *                   La comparación usa fechas en formato YYYY-MM-DD calculadas
   *                   con hora local del servidor (UTC-3) para evitar desfases.
   */
  async findPendingExpectedDeposits(daysAhead = 0): Promise<Booking[]> {
    const fromDate = new Date();
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + Math.max(0, daysAhead));

    const toYMD = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const from = toYMD(fromDate);
    const to = toYMD(toDate);

    return this.bookingRepo
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.court', 'court')
      .leftJoinAndSelect('booking.payment', 'payment')
      .where('booking.expectedDepositAmount IS NOT NULL')
      .andWhere('booking.expectedDepositAmount > 0')
      .andWhere('booking.status NOT IN (:...excluded)', {
        excluded: [BookingStatus.CANCELLED, BookingStatus.COMPLETED],
      })
      .andWhere('booking.date BETWEEN :from AND :to', { from, to })
      .andWhere('(payment.id IS NULL OR payment.amount_transfer < booking.expectedDepositAmount)')
      .orderBy('booking.date', 'ASC')
      .addOrderBy('booking.hour', 'ASC')
      .getMany();
  }

  /** Retorna los turnos de una fecha, opcionalmente filtrados por cancha. */
  async findByDate(query: QueryBookingsDto): Promise<Booking[]> {
    const qb = this.bookingRepo
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.court', 'court')
      .leftJoinAndSelect('booking.items', 'items')
      .leftJoinAndSelect('items.product', 'product')
      .leftJoinAndSelect('booking.payment', 'payment')
      .leftJoinAndSelect('booking.createdByUser', 'user')
      .leftJoinAndSelect('booking.fixedBooking', 'fixedBooking')
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
      relations: ['court', 'items', 'items.product', 'payment', 'createdByUser', 'fixedBooking'],
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
    if (dto.sourceId) {
      const source = await this.findOne(dto.sourceId);
      if (source.status === BookingStatus.COMPLETED) {
        throw new BadRequestException('No se permite duplicar un turno que ya ha finalizado.');
      }
      if (!dto.clientName) dto.clientName = source.clientName;
      if (!dto.priceType) dto.priceType = source.priceType as PriceType;
      if (dto.durationMinutes === undefined) dto.durationMinutes = source.durationMinutes;
      if (dto.items === undefined)
        dto.items = source.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
      if (dto.amountCash === undefined) dto.amountCash = 0;
      if (dto.amountTransfer === undefined) dto.amountTransfer = 0;
    }

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

      const activeStatuses = [BookingStatus.BOOKED, BookingStatus.PLAYING, BookingStatus.COMPLETED];
      const overlappingBooking = await queryRunner.manager
        .createQueryBuilder(Booking, 'b')
        .setLock('pessimistic_write')
        .where('b.court_id = :courtId', { courtId: dto.courtId })
        .andWhere('b.date = :date', { date: dto.date })
        .andWhere('b.status IN (:...activeStatuses)', { activeStatuses })
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

      await queryRunner.manager
        .createQueryBuilder()
        .delete()
        .from(Booking)
        .where('court_id = :courtId', { courtId: dto.courtId })
        .andWhere('date = :date', { date: dto.date })
        .andWhere('hour = :hour', { hour: dto.hour })
        .andWhere('status = :cancelled', { cancelled: BookingStatus.CANCELLED })
        .execute();

      const priceType = dto.priceType ?? PriceType.STANDARD;
      const duration = dto.durationMinutes ?? 60;
      const { amount: priceAmount, shiftName: appliedShiftName } = await this.calculateDynamicPrice(
        dto.date,
        dto.hour,
        priceType === PriceType.PROFESSOR,
        duration,
        queryRunner,
      );

      const bookingItems = await this.processItems(dto.items ?? [], queryRunner);

      const booking = queryRunner.manager.create(Booking, {
        courtId: dto.courtId,
        date: dto.date,
        hour: dto.hour,
        clientName: dto.clientName,
        status: BookingStatus.BOOKED,
        priceType,
        priceAmount,
        appliedShiftName,
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

      if (amountCash > 0 || amountTransfer > 0) {
        const session = await this.cashRegisterService.getActiveSessionOrFail(queryRunner, user.id);

        await this.cashRegisterService.registerTransaction(queryRunner, {
          cashSessionId: session.id,
          type: TransactionType.BOOKING,
          referenceId: savedBooking.id,
          concept: `Turno ${court.name} - ${dto.hour}hs (${dto.clientName})`,
          amountCash,
          amountTransfer,
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

      let rescheduleFields: { courtId?: string; date?: string; hour?: string } | null = null;
      if (dto.courtId !== undefined || dto.date !== undefined || dto.hour !== undefined) {
        if (booking.status === BookingStatus.COMPLETED) {
          throw new BadRequestException(
            'No se puede mover o modificar la fecha de un turno que ya ha finalizado.',
          );
        }
        if (booking.status === BookingStatus.CANCELLED && user.role !== UserRole.ADMIN) {
          throw new ForbiddenException('Solo los administradores pueden mover turnos cancelados.');
        }

        const targetCourtId = dto.courtId ?? booking.courtId;
        const targetDate = dto.date ?? booking.date;
        const targetHour = dto.hour ?? booking.hour;

        const court = await queryRunner.manager.findOne(Court, {
          where: { id: targetCourtId, isActive: true },
        });
        if (!court) {
          throw new NotFoundException(`Cancha ${targetCourtId} no encontrada o inactiva.`);
        }

        const [h, m] = targetHour.split(':').map(Number);
        const newStartMin = h * 60 + m;
        const newEndMin = newStartMin + booking.durationMinutes;

        const conflict = await queryRunner.manager
          .createQueryBuilder(Booking, 'b')
          .setLock('pessimistic_write')
          .where('b.court_id = :courtId', { courtId: targetCourtId })
          .andWhere('b.date = :date', { date: targetDate })
          .andWhere('b.id != :id', { id })
          .andWhere('b.status != :cancelled', { cancelled: BookingStatus.CANCELLED })
          .andWhere(
            `(CAST(SPLIT_PART(b.hour,':',1) AS INT)*60 + CAST(SPLIT_PART(b.hour,':',2) AS INT)) < :end`,
            { end: newEndMin },
          )
          .andWhere(
            `:start < (CAST(SPLIT_PART(b.hour,':',1) AS INT)*60 + CAST(SPLIT_PART(b.hour,':',2) AS INT) + b.duration_minutes)`,
            { start: newStartMin },
          )
          .getOne();

        if (conflict) {
          throw new ConflictException(
            `El slot ${court.name} - ${targetHour}hs del ${targetDate} se solapa con el turno de ${conflict.clientName}.`,
          );
        }

        const { amount: newPriceAmount, shiftName: newShiftName } =
          await this.calculateDynamicPrice(
            targetDate,
            targetHour,
            booking.priceType === PriceType.PROFESSOR,
            booking.durationMinutes,
            queryRunner,
          );
        rescheduleFields = {
          courtId: targetCourtId,
          date: targetDate,
          hour: targetHour,
          priceAmount: newPriceAmount,
          appliedShiftName: newShiftName,
        } as any;
      }

      let itemsTotal = 0;

      if (dto.items !== undefined) {
        const existingItems = bookingWithRelations?.items ?? [];

        if (existingItems.length > 0) {
          const ids = existingItems.map((i) => i.id);
          const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(', ');
          await queryRunner.query(`DELETE FROM booking_items WHERE id IN (${placeholders})`, ids);
        }

        const newItems = await this.processItems(dto.items, queryRunner, existingItems);
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
        await this.commitStock(booking.id, queryRunner);

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
        const prevCash = Number(bookingWithRelations?.payment?.amountCash ?? 0);
        const prevTransfer = Number(bookingWithRelations?.payment?.amountTransfer ?? 0);
        const newCash = dto.amountCash ?? prevCash;
        const newTransfer = dto.amountTransfer ?? prevTransfer;

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

        const deltaCash = newCash - prevCash;
        const deltaTransfer = newTransfer - prevTransfer;

        if (deltaCash > 0 || deltaTransfer > 0) {
          const court = await queryRunner.manager.findOne(Court, {
            where: { id: booking.courtId },
          });
          const session = await this.cashRegisterService.getActiveSessionOrFail(
            queryRunner,
            user.id,
          );
          await this.cashRegisterService.registerTransaction(queryRunner, {
            cashSessionId: session.id,
            type: TransactionType.BOOKING,
            referenceId: booking.id,
            concept: `Pago turno ${court?.name ?? ''} - ${booking.hour}hs (${booking.clientName})`,
            amountCash: Math.max(0, deltaCash),
            amountTransfer: Math.max(0, deltaTransfer),
            createdByUserId: user.id,
          });
        }
      }

      const bookingFields: Partial<Booking> = {};
      if (dto.clientName) bookingFields.clientName = dto.clientName;
      if (dto.status) bookingFields.status = dto.status;
      if (dto.isConfirmed !== undefined) bookingFields.isConfirmed = dto.isConfirmed;
      if (rescheduleFields) Object.assign(bookingFields, rescheduleFields);

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

  /**
   * Confirma la seña esperada de un turno fijo con un clic.
   *
   * Reglas:
   * - El booking debe tener `expectedDepositAmount > 0`.
   * - Si ya existe un pago por transferencia >= expectedDepositAmount, lanza error
   *   (idempotencia: evita duplicar la confirmación).
   * - No requiere sesión de caja abierta (es transferencia).
   * - Crea o incrementa `BookingPayment.amountTransfer` dentro de una transacción.
   * - Limpia `expectedDepositAmount` del booking para que el botón desaparezca en UI.
   */
  async confirmExpectedDeposit(id: string, user: User): Promise<Booking> {
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

      const expected = Number(booking.expectedDepositAmount ?? 0);

      if (expected <= 0) {
        throw new BadRequestException(
          'Este turno no tiene una seña recurrente esperada configurada.',
        );
      }

      const existingPayment = await queryRunner.manager.findOne(BookingPayment, {
        where: { bookingId: id },
      });

      const alreadyTransferred = Number(existingPayment?.amountTransfer ?? 0);
      if (alreadyTransferred >= expected) {
        throw new BadRequestException(
          `La seña ya fue registrada (transferencia: $${alreadyTransferred}).`,
        );
      }

      if (existingPayment) {
        await queryRunner.manager.increment(
          BookingPayment,
          { id: existingPayment.id },
          'amountTransfer',
          expected,
        );
      } else {
        const payment = queryRunner.manager.create(BookingPayment, {
          bookingId: id,
          amountCash: 0,
          amountTransfer: expected,
        });
        await queryRunner.manager.save(BookingPayment, payment);
      }

      await queryRunner.manager.update(Booking, { id }, { expectedDepositAmount: null });

      await queryRunner.commitTransaction();

      this.logger.log(
        `Seña confirmada: turno ${id} — $${expected} por transferencia (por ${user.username})`,
      );

      return this.findOne(id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.warn(`ROLLBACK en confirmación de seña (turno ${id}): ${error.message}`);
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

      await queryRunner.manager.update(
        Booking,
        { id: booking.id },
        { status: BookingStatus.CANCELLED },
      );

      await queryRunner.commitTransaction();
      this.logger.log(`Turno ${id} cancelado por admin ${user.username}.`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.handleDbError(error);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Devuelve `true` si la categoría corresponde a "Alquileres" (servicio sin stock finito).
   * Recibe el nombre por separado para evitar joins en consultas con lock (error 0A000).
   */
  private isCategoryRental(categoryName: string | undefined): boolean {
    return (categoryName ?? '').toLowerCase().includes('alquiler');
  }

  /**
   * SOFT COMMIT — Verifica existencia y stock disponible sin tocar la tabla `products`.
   * El stock real se descuenta recién en `commitStock()` al finalizar el turno.
   * Retorna los items enriquecidos con el precio snapshot del momento.
   *
   * @param items         - Nuevos items a persistir.
   * @param queryRunner   - QueryRunner de la transacción activa.
   * @param existingItems - Items actuales de la reserva ANTES del reemplazo.
   *                        Se usa para calcular el stock efectivo disponible en un
   *                        escenario de reemplazo: si el código anterior ya descontó
   *                        esa cantidad, la "devolvemos" al validar la nueva.
   *
   * Stock efectivo = product.stock + cantidadYaEnReserva
   * Esto hace la validación correcta tanto para reservas nuevas (existingQty=0)
   * como para reemplazos de items existentes (existingQty > 0).
   */
  private async processItems(
    items: { productId: string; quantity: number }[],
    queryRunner: any,
    existingItems: { productId: string; quantity: number }[] = [],
  ): Promise<{ productId: string; quantity: number; unitPrice: number }[]> {
    const result: { productId: string; quantity: number; unitPrice: number }[] = [];

    const aggregated = new Map<string, number>();
    for (const item of items) {
      aggregated.set(item.productId, (aggregated.get(item.productId) ?? 0) + item.quantity);
    }
    const deduped = Array.from(aggregated, ([productId, quantity]) => ({ productId, quantity }));

    const existingQtyMap = new Map<string, number>();
    for (const ei of existingItems) {
      existingQtyMap.set(ei.productId, (existingQtyMap.get(ei.productId) ?? 0) + ei.quantity);
    }

    for (const item of deduped) {
      const product = await queryRunner.manager.findOne(Product, {
        where: { id: item.productId, isActive: true },
        loadEagerRelations: false,
      });

      if (!product) {
        throw new NotFoundException(`Producto con ID ${item.productId} no encontrado o inactivo.`);
      }

      const category = product.categoryId
        ? await queryRunner.manager.findOne(ProductCategory, {
            where: { id: product.categoryId },
          })
        : null;

      if (!this.isCategoryRental(category?.name)) {
        if (product.stock < item.quantity) {
          throw new BadRequestException(
            `Stock insuficiente para "${product.name}". ` +
              `Disponible: ${product.stock}, solicitado: ${item.quantity}.`,
          );
        }
      }

      result.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: Number(product.salePrice),
      });
    }

    return result;
  }

  /**
   * HARD COMMIT — Descuenta el stock real al finalizar el turno (status → COMPLETED).
   * Aplica bloqueo pesimista DIRECTAMENTE sobre `Product` sin joins (evita error 0A000).
   * Los productos de categoría "Alquileres" se omiten.
   * Lanza BadRequestException si algún producto ya no tiene stock suficiente.
   */
  private async commitStock(bookingId: string, queryRunner: any): Promise<void> {
    const bookingWithItems = await queryRunner.manager.findOne(Booking, {
      where: { id: bookingId },
      relations: ['items'],
    });

    for (const item of bookingWithItems?.items ?? []) {
      const product = await queryRunner.manager.findOne(Product, {
        where: { id: item.productId },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });

      if (!product) continue;

      const category = product.categoryId
        ? await queryRunner.manager.findOne(ProductCategory, {
            where: { id: product.categoryId },
          })
        : null;

      if (this.isCategoryRental(category?.name)) continue;

      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Stock insuficiente para finalizar el turno: "${product.name}". ` +
            `Disponible: ${product.stock}, requerido: ${item.quantity}.`,
        );
      }

      await queryRunner.manager.decrement(Product, { id: product.id }, 'stock', item.quantity);
    }

    this.logger.log(`Stock descontado (hard commit) para turno ${bookingId}.`);
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

  /**
   * Motor de Precios Dinámico.
   *
   * Busca la franja horaria activa que coincida con el día de la semana
   * y la hora del turno. Si encuentra una, usa su precio. Si no hay
   * ninguna configurada devuelve 0 (el operador deberá ajustar el precio).
   *
   * @param date              - Fecha del turno (YYYY-MM-DD).
   * @param hour              - Hora del turno (HH:mm).
   * @param isTeacherIncluded - true cuando priceType === PROFESSOR.
   * @param duration          - Duración en minutos.
   * @param queryRunner       - QueryRunner activo de la transacción.
   */
  private async calculateDynamicPrice(
    date: string,
    hour: string,
    isTeacherIncluded: boolean,
    duration: number,
    queryRunner: any,
  ): Promise<{ amount: number; shiftName: string }> {
    const [year, month, day] = date.split('-').map(Number);
    const dayOfWeek = new Date(year, month - 1, day).getDay();

    const [h, m] = hour.split(':').map(Number);
    const bookingMin = h * 60 + m;

    const shifts: PricingShift[] = await queryRunner.manager.find(PricingShift, {
      where: { isActive: true },
    });

    const matching = shifts.find((s) => {
      const days = (s.daysOfWeek as any[]).map(Number);
      if (!days.includes(dayOfWeek)) return false;
      const [sh, sm] = s.startTime.split(':').map(Number);
      const [eh, em] = s.endTime.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      return startMin <= endMin
        ? bookingMin >= startMin && bookingMin < endMin
        : bookingMin >= startMin || bookingMin < endMin;
    });

    if (matching) {
      let base: number;
      switch (duration) {
        case 30:
          base = Number(matching.price30min);
          break;
        case 90:
          base = Number(matching.price90min);
          break;
        case 120:
          base = Number(matching.price120min);
          break;
        default:
          base = Number(matching.price60min);
          break;
      }
      const extra = isTeacherIncluded ? Number(matching.teacherPricePerHour) * (duration / 60) : 0;
      this.logger.log(
        `Precio dinámico: franja "${matching.name}" → $${base}${isTeacherIncluded ? ` + $${extra} (profesor)` : ''}`,
      );
      return { amount: base + extra, shiftName: matching.name };
    }

    this.logger.warn(`Sin franja horaria para ${date} ${hour}hs (día ${dayOfWeek}). Precio = 0.`);
    return { amount: 0, shiftName: 'Estándar' };
  }

  /**
   * Backfill de `appliedShiftName` para reservas históricas (appliedShiftName IS NULL).
   *
   * Carga todos los shifts activos una sola vez, resuelve el nombre de franja para
   * cada reserva y agrupa los IDs por nombre para emitir un UPDATE … WHERE id IN (…)
   * por grupo — minimizando el número de queries a la DB.
   *
   * Seguro de ejecutar más de una vez: solo toca filas con appliedShiftName = NULL.
   */
  async backfillShiftNames(): Promise<{ updated: number }> {
    const bookings = await this.bookingRepo.find({
      where: { appliedShiftName: IsNull() },
      select: ['id', 'date', 'hour', 'durationMinutes'],
    });

    if (!bookings.length) {
      this.logger.log('Backfill shift names: sin registros con appliedShiftName = null.');
      return { updated: 0 };
    }

    const shifts = await this.dataSource
      .getRepository(PricingShift)
      .find({ where: { isActive: true } });

    const groups = new Map<string, string[]>();
    for (const booking of bookings) {
      const name = this.resolveShiftName(booking.date, booking.hour, shifts);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(booking.id);
    }

    let updated = 0;
    for (const [shiftName, ids] of groups) {
      const result = await this.bookingRepo.update(
        { id: In(ids) },
        { appliedShiftName: shiftName },
      );
      updated += result.affected ?? 0;
      this.logger.log(`Backfill: "${shiftName}" → ${result.affected} registro(s) actualizados.`);
    }

    this.logger.log(`Backfill completado. Total actualizados: ${updated}.`);
    return { updated };
  }

  /**
   * Resuelve el nombre de la franja horaria para una fecha/hora dada,
   * usando la lista de shifts ya cargada. No realiza queries a la DB.
   * Retorna 'Estándar' si ninguna franja cubre el slot.
   */
  private resolveShiftName(date: string, hour: string, shifts: PricingShift[]): string {
    const [year, month, day] = date.split('-').map(Number);
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    const [h, m] = hour.split(':').map(Number);
    const bookingMin = h * 60 + m;

    const matching = shifts.find((s) => {
      const days = (s.daysOfWeek as number[]).map(Number);
      if (!days.includes(dayOfWeek)) return false;
      const [sh, sm] = s.startTime.split(':').map(Number);
      const [eh, em] = s.endTime.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      return startMin <= endMin
        ? bookingMin >= startMin && bookingMin < endMin
        : bookingMin >= startMin || bookingMin < endMin;
    });

    return matching?.name ?? 'Estándar';
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
