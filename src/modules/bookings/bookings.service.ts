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

// ─────────────────────────────────────────────────────────────────────────────
//  ESTRATEGIA DE ANTI-OVERBOOKING
// ─────────────────────────────────────────────────────────────────────────────
//
//  Problema: si dos peticiones concurrentes verifican que el slot (court, date,
//  hour) está libre y ambas "ven" que sí lo está, ambas intentarán insertar un
//  turno → doble reserva.
//
//  Solución en dos capas:
//
//  CAPA 1 – Advisory Lock de PostgreSQL (pg_advisory_xact_lock)
//  ┌──────────────────────────────────────────────────────────────────────┐
//  │  await queryRunner.query(                                            │
//  │    `SELECT pg_advisory_xact_lock(abs(hashtext($1)))`,               │
//  │    [`${courtId}:${date}:${hour}`]                                   │
//  │  );                                                                  │
//  └──────────────────────────────────────────────────────────────────────┘
//  - Es un lock a nivel de TRANSACCIÓN en PostgreSQL.
//  - hashtext() convierte el string (court+date+hour) en un entero bigint.
//  - La segunda petición con el mismo slot ESPERA hasta que la primera
//    haga COMMIT o ROLLBACK. No hay spinning ni polling: el motor de PG
//    lo maneja internamente.
//  - Al liberar la primera transacción, la segunda entra, hace SELECT,
//    encuentra la fila ya insertada, y lanza 409 Conflict.
//
//  CAPA 2 – UNIQUE constraint en DB (court_id, date, hour)
//  ┌──────────────────────────────────────────────────────────────────────┐
//  │  @Unique('UQ_booking_court_date_hour', ['courtId', 'date', 'hour']) │
//  └──────────────────────────────────────────────────────────────────────┘
//  - Red de seguridad si el advisory lock falla o se bypasea.
//  - PostgreSQL lanza error code '23505' (unique_violation), que capturamos
//    y convertimos en un 409 limpio.
//
//  Combinadas, estas dos capas garantizan tolerancia a condiciones de carrera
//  incluso bajo alta concurrencia.
// ─────────────────────────────────────────────────────────────────────────────

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

  // ───────────────────────────────────────────────────────────────────────────
  //  GET: Grilla del día
  // ───────────────────────────────────────────────────────────────────────────

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

  // ───────────────────────────────────────────────────────────────────────────
  //  POST: Crear turno (transacción completa con anti-overbooking)
  // ───────────────────────────────────────────────────────────────────────────

  async create(dto: CreateBookingDto, user: User): Promise<Booking> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // ── PASO 1: Advisory Lock ─────────────────────────────────────────────
      // Serializa peticiones concurrentes para el mismo slot.
      // hashtext() es determinista: mismo input → mismo hash → mismo lock.
      const slotKey = `${dto.courtId}:${dto.date}:${dto.hour}`;
      await queryRunner.query(`SELECT pg_advisory_xact_lock(abs(hashtext($1)))`, [slotKey]);

      // ── PASO 2: Verificar que la cancha existe y está activa ──────────────
      const court = await queryRunner.manager.findOne(Court, {
        where: { id: dto.courtId, isActive: true },
      });

      if (!court) {
        throw new NotFoundException(`Cancha con ID ${dto.courtId} no encontrada o inactiva.`);
      }

      // ── PASO 3: Verificar solapamiento de rango (SELECT FOR UPDATE) ────────
      //
      // La comprobación anterior solo detectaba colisiones en la hora EXACTA,
      // lo que permitía que un turno de 90 min en 10:00 coexistiera con uno en
      // 11:00 (siendo que ambos ocupan el mismo tiempo real).
      //
      // Ahora usamos una comprobación de SOLAPAMIENTO DE INTERVALOS:
      //   Dos intervalos [A_start, A_end) y [B_start, B_end) se solapan si:
      //     A_start < B_end  AND  B_start < A_end
      //
      // Las horas se convierten a minutos del día para poder compararlas con SQL.
      // Se buscan colisiones contra CUALQUIER turno no cancelado (booked, playing,
      // completed) ya que un turno completado sigue ocupando ese bloque de tiempo.
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
          // Existing booking starts before new booking ends
          `(CAST(SPLIT_PART(b.hour, ':', 1) AS INTEGER) * 60
            + CAST(SPLIT_PART(b.hour, ':', 2) AS INTEGER)) < :newEnd`,
          { newEnd: newEndMin },
        )
        .andWhere(
          // New booking starts before existing booking ends
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

      // ── PASO 4: Obtener precio desde la configuración del sistema ─────────
      const prices = await this.systemConfigService.getPrices();
      const priceType = dto.priceType ?? PriceType.STANDARD;
      const priceAmount = priceType === PriceType.PROFESSOR ? prices.professor : prices.standard;

      // ── PASO 5: Procesar productos del buffet (stock) ─────────────────────
      const bookingItems = await this.processItems(dto.items ?? [], queryRunner);

      // ── PASO 6: Crear el turno ────────────────────────────────────────────
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

      // ── PASO 7: Guardar items del buffet ──────────────────────────────────
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

      // ── PASO 8: Guardar el pago ───────────────────────────────────────────
      const amountCash = dto.amountCash ?? 0;
      const amountTransfer = dto.amountTransfer ?? 0;

      const payment = queryRunner.manager.create(BookingPayment, {
        bookingId: savedBooking.id,
        amountCash,
        amountTransfer,
      });
      await queryRunner.manager.save(BookingPayment, payment);

      // ── PASO 9 (FASE 5): Registrar el pago en Caja ───────────────────────
      // Solo si hubo pago efectivo o transferencia (puede ser una seña $0)
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

      // ── COMMIT ────────────────────────────────────────────────────────────
      await queryRunner.commitTransaction();

      this.logger.log(
        `Turno creado: ${court.name} ${dto.date} ${dto.hour}hs → ${dto.clientName} (por ${user.username})`,
      );

      // Retornar el turno completo con relaciones
      return this.findOne(savedBooking.id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.warn(`ROLLBACK en creación de turno: ${error.message}`);
      this.handleDbError(error);
    } finally {
      await queryRunner.release();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  PATCH: Actualizar turno
  // ───────────────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateBookingDto, user: User): Promise<Booking> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // ── PASO 1: Bloquear el turno (SELECT FOR UPDATE) ─────────────────────
      // IMPORTANTE: PostgreSQL prohíbe combinar FOR UPDATE con LEFT JOIN
      // (nullable outer join). Por eso usamos DOS consultas separadas:
      // la primera bloquea la fila SIN relaciones; la segunda carga
      // las relaciones SIN lock.
      const booking = await queryRunner.manager.findOne(Booking, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!booking) {
        throw new NotFoundException(`Turno con ID ${id} no encontrado.`);
      }

      // Cargamos relaciones en una segunda consulta, sin lock
      const bookingWithRelations = await queryRunner.manager.findOne(Booking, {
        where: { id },
        relations: ['items', 'payment'],
      });

      // ── PASO 2: Idempotencia de estado ────────────────────────────────────
      // Si el cliente envía el mismo estado que ya tiene el turno (ej. doble
      // clic en "Iniciar partido" cuando la primera respuesta tardó en llegar),
      // retornamos el turno sin ejecutar ninguna lógica de negocio.
      // Esto convierte todas las transiciones de estado en operaciones idempotentes.
      if (dto.status && booking.status === dto.status) {
        await queryRunner.rollbackTransaction();
        this.logger.log(
          `Turno ${id} ya está en estado "${dto.status}" — respuesta idempotente sin cambios.`,
        );
        return this.findOne(id);
      }

      // ── PASO 3: Validar transición de estado ─────────────────────────────
      if (dto.status) {
        this.validateStatusTransition(booking.status, dto.status, user);
      }

      // ── PASO 4: Actualizar items del buffet si se envían ──────────────────
      let itemsTotal = 0;

      if (dto.items !== undefined) {
        const existingItems = bookingWithRelations?.items ?? [];

        // 4a. Devolver el stock de los items anteriores
        await this.restoreStock(existingItems, queryRunner);

        // 4b. Eliminar items anteriores con SQL raw — evita completamente
        //     la ambigüedad del patrón FK dual-column de TypeORM.
        if (existingItems.length > 0) {
          const ids = existingItems.map((i) => i.id);
          const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(', ');
          await queryRunner.query(`DELETE FROM booking_items WHERE id IN (${placeholders})`, ids);
        }

        // 4c. Procesar y descontar los nuevos items
        const newItems = await this.processItems(dto.items, queryRunner);
        itemsTotal = newItems.reduce((sum, i) => sum + Number(i.unitPrice) * i.quantity, 0);

        // INSERT con SQL raw — garantiza columnas exactas sin interferencia ORM.
        for (const item of newItems) {
          await queryRunner.query(
            `INSERT INTO booking_items (booking_id, product_id, quantity, unit_price)
             VALUES ($1, $2, $3, $4)`,
            [booking.id, item.productId, item.quantity, item.unitPrice],
          );
        }
      } else {
        // Usar items existentes para calcular el total
        itemsTotal = (bookingWithRelations?.items ?? []).reduce(
          (sum, i) => sum + Number(i.unitPrice) * i.quantity,
          0,
        );
      }

      // ── PASO 5: Validación de pago para completar (DESPUÉS de procesar items) ──
      // Se usan los montos del DTO si se envían; si no, los que ya están en la DB.
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

      // ── PASO 6: Actualizar pago si se envía ───────────────────────────────
      const hasPaymentUpdate = dto.amountCash !== undefined || dto.amountTransfer !== undefined;

      if (hasPaymentUpdate) {
        if (bookingWithRelations?.payment) {
          // UPDATE directo sobre el registro de pago existente
          const paymentFields: Partial<BookingPayment> = {};
          if (dto.amountCash !== undefined) paymentFields.amountCash = dto.amountCash;
          if (dto.amountTransfer !== undefined) paymentFields.amountTransfer = dto.amountTransfer;
          await queryRunner.manager.update(
            BookingPayment,
            bookingWithRelations.payment.id,
            paymentFields,
          );
        } else {
          // INSERT raw: evita ambigüedad del patrón FK dual-column en BookingPayment
          await queryRunner.query(
            `INSERT INTO booking_payments (booking_id, amount_cash, amount_transfer)
             VALUES ($1, $2, $3)`,
            [booking.id, dto.amountCash ?? 0, dto.amountTransfer ?? 0],
          );
        }
      }

      // ── PASO 7: Actualizar campos del turno ───────────────────────────────
      // UPDATE directo evita cascade-save sobre relaciones.
      const bookingFields: Partial<Booking> = {};
      if (dto.clientName) bookingFields.clientName = dto.clientName;
      if (dto.status) bookingFields.status = dto.status;

      if (Object.keys(bookingFields).length > 0) {
        await queryRunner.manager.update(Booking, { id: booking.id }, bookingFields);
      }

      // ── COMMIT ────────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────────────────────
  //  DELETE (lógico): Cancelar turno — SOLO ADMIN
  // ───────────────────────────────────────────────────────────────────────────

  async cancel(id: string, user: User): Promise<void> {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Solo los administradores pueden cancelar turnos.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // IMPORTANTE: PostgreSQL prohíbe FOR UPDATE con LEFT JOIN.
      // Separamos en dos consultas: lock sin relaciones, relaciones sin lock.
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

      // Cargamos items sin lock para restaurar stock
      const bookingWithItems = await queryRunner.manager.findOne(Booking, {
        where: { id },
        relations: ['items'],
      });

      // Devolver stock de los productos del buffet
      await this.restoreStock(bookingWithItems?.items ?? [], queryRunner);

      // UPDATE directo: evita que TypeORM haga cascade-save sobre las relaciones
      // cargadas (items, payment), que causaba el Error 500 por restricción FK.
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

  // ───────────────────────────────────────────────────────────────────────────
  //  PRIVADOS: Lógica de stock
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Procesa un array de items del buffet:
   * 1. Bloquea cada producto con SELECT FOR UPDATE
   * 2. Verifica stock disponible
   * 3. Descuenta el stock
   *
   * Si algún producto no tiene stock suficiente, lanza BadRequestException
   * y el QueryRunner padre hace ROLLBACK de TODO (incluido cualquier
   * item ya procesado anteriormente en el mismo loop).
   */
  private async processItems(
    items: { productId: string; quantity: number }[],
    queryRunner: any,
  ): Promise<{ productId: string; quantity: number; unitPrice: number }[]> {
    const result: { productId: string; quantity: number; unitPrice: number }[] = [];

    for (const item of items) {
      // SELECT FOR UPDATE: bloquea la fila del producto para que ninguna
      // otra transacción concurrente pueda leer/modificar su stock
      // hasta que hagamos COMMIT o ROLLBACK.
      const product = await queryRunner.manager.findOne(Product, {
        where: { id: item.productId, isActive: true },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false, // evita LEFT JOIN en category (nullable) con FOR UPDATE
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

      // Descontar stock con UPDATE atómico
      await queryRunner.manager.decrement(Product, { id: product.id }, 'stock', item.quantity);

      result.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: Number(product.salePrice), // snapshot del precio actual
      });
    }

    return result;
  }

  /**
   * Restaura el stock de los items de un turno.
   * Se usa al cancelar un turno o al reemplazar items en un update.
   */
  private async restoreStock(items: BookingItem[], queryRunner: any): Promise<void> {
    for (const item of items) {
      await queryRunner.manager.increment(Product, { id: item.productId }, 'stock', item.quantity);
    }

    if (items.length > 0) {
      this.logger.debug(`Stock restaurado para ${items.length} productos del turno.`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  PRIVADOS: Validaciones de negocio
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Máquina de estados de los turnos.
   *
   * Estados válidos:
   *   BOOKED → PLAYING   (empleado/admin: el cliente llegó a jugar)
   *   BOOKED → CANCELLED (solo admin)
   *   PLAYING → COMPLETED (empleado/admin: turno terminado)
   *   PLAYING → CANCELLED (solo admin, caso excepcional)
   *   COMPLETED → (ninguno, estado terminal)
   *   CANCELLED → (ninguno, estado terminal)
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
   * Convierte errores de base de datos en excepciones HTTP apropiadas.
   * Se llama en todos los catch() de los métodos transaccionales.
   */
  private handleDbError(error: any): never {
    // Unique violation de PostgreSQL → ya existe el turno en ese slot
    if (error?.code === '23505') {
      throw new ConflictException(
        'Ese horario ya fue reservado por otro usuario. Por favor recargue la agenda.',
      );
    }

    // Check constraint violation (stock < 0, quantity <= 0)
    if (error?.code === '23514') {
      throw new BadRequestException('Operación inválida: se intentó dejar stock negativo.');
    }

    // Si ya es una HttpException (NotFoundException, ConflictException, etc.),
    // la re-lanzamos directamente sin envolver
    if (error?.getStatus) {
      throw error;
    }

    // Error inesperado
    this.logger.error('Error de base de datos no controlado:', error);
    this.logger.error('Stack:', error?.stack);
    throw new InternalServerErrorException(
      `Error interno: ${error?.message ?? 'desconocido'} (code: ${error?.code ?? 'n/a'})`,
    );
  }
}
