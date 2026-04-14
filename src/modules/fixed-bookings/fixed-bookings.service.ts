import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import { FixedBooking } from './entities/fixed-booking.entity';
import { Booking, BookingStatus, PriceType } from '../bookings/entities/booking.entity';
import { Court } from '../courts/entities/court.entity';
import { User } from '../users/entities/user.entity';
import { PricingShift } from '../pricing-shifts/entities/pricing-shift.entity';

import { CreateFixedBookingDto } from './dto/create-fixed-booking.dto';
import { UpdateFixedBookingDto } from './dto/update-fixed-booking.dto';

/** Semanas hacia adelante para las que se generan Bookings individuales al crear/activar. */
const WEEKS_TO_GENERATE = 8;

@Injectable()
export class FixedBookingsService {
  private readonly logger = new Logger(FixedBookingsService.name);

  constructor(
    @InjectRepository(FixedBooking)
    private readonly fixedRepo: Repository<FixedBooking>,

    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,

    @InjectRepository(Court)
    private readonly courtRepo: Repository<Court>,

    @InjectRepository(PricingShift)
    private readonly shiftRepo: Repository<PricingShift>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** Lista todos los turnos fijos, ordenados por día de semana y hora. */
  async findAll(): Promise<FixedBooking[]> {
    return this.fixedRepo.find({
      relations: ['court'],
      order: { dayOfWeek: 'ASC', hour: 'ASC' },
    });
  }

  /** Retorna un turno fijo por ID. */
  async findOne(id: string): Promise<FixedBooking> {
    const fixed = await this.fixedRepo.findOne({
      where: { id },
      relations: ['court'],
    });
    if (!fixed) {
      throw new NotFoundException(`Turno fijo con ID ${id} no encontrado.`);
    }
    return fixed;
  }

  /**
   * Convierte una hora "HH:MM" a minutos desde medianoche.
   * Soporta madrugada (00:xx, 01:xx) tratándola como 24:xx, 25:xx
   * para que el orden temporal sea coherente con horas nocturnas (≥09:00).
   */
  private toMinutes(hour: string): number {
    const [h, m] = hour.split(':').map(Number);
    const adjusted = h < 9 ? h + 24 : h;
    return adjusted * 60 + m;
  }

  /**
   * Verifica si dos rangos horarios [startA, endA) y [startB, endB) se solapan.
   */
  private rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
    return startA < endB && startB < endA;
  }

  /**
   * Lanza ConflictException si el slot (courtId, dayOfWeek, hour, durationMinutes)
   * se solapa con algún turno fijo activo existente.
   * @param excludeId  ID del turno fijo a excluir (en edición: el propio turno).
   */
  private async checkFixedOverlap(
    courtId: string,
    dayOfWeek: number,
    hour: string,
    durationMinutes: number,
    excludeId?: string,
  ): Promise<void> {
    const candidates = await this.fixedRepo.find({
      where: { courtId, dayOfWeek, isActive: true },
    });

    const newStart = this.toMinutes(hour);
    const newEnd = newStart + durationMinutes;

    for (const fb of candidates) {
      if (excludeId && fb.id === excludeId) continue;
      const existStart = this.toMinutes(fb.hour);
      const existEnd = existStart + fb.durationMinutes;
      if (this.rangesOverlap(newStart, newEnd, existStart, existEnd)) {
        throw new ConflictException({
          message: 'CONFLICT_OVERLAP',
          detail: `La cancha ya tiene un turno fijo de ${fb.clientName} a las ${fb.hour} (${fb.durationMinutes} min) que se superpone con el horario solicitado.`,
        });
      }
    }
  }

  /**
   * Crea un turno fijo y genera automáticamente los Booking individuales
   * para las próximas {@link WEEKS_TO_GENERATE} semanas.
   */
  async create(dto: CreateFixedBookingDto, user: User): Promise<FixedBooking> {
    const court = await this.courtRepo.findOne({ where: { id: dto.courtId } });
    if (!court) {
      throw new NotFoundException(`Cancha con ID ${dto.courtId} no encontrada.`);
    }
    if (!court.isActive) {
      throw new BadRequestException('No se pueden asignar turnos a una cancha inactiva.');
    }

    await this.checkFixedOverlap(dto.courtId, dto.dayOfWeek, dto.hour, dto.durationMinutes ?? 60);

    const conflict = await this.bookingRepo.findOne({
      where: {
        courtId: dto.courtId,
        date: dto.startDate,
        hour: dto.hour,
      },
    });
    if (conflict && conflict.status !== BookingStatus.CANCELLED) {
      const next = new Date(dto.startDate + 'T00:00:00');
      next.setDate(next.getDate() + 7);
      const nextAvailableDate = next.toISOString().slice(0, 10);
      throw new ConflictException({
        message: 'CONFLICT_START_DATE',
        nextAvailableDate,
      });
    }

    const fixed = this.fixedRepo.create({
      clientName: dto.clientName,
      phoneNumber: dto.phoneNumber ?? null,
      dayOfWeek: dto.dayOfWeek,
      hour: dto.hour,
      durationMinutes: dto.durationMinutes ?? 60,
      courtId: dto.courtId,
      isActive: true,
      startDate: dto.startDate,
      notes: dto.notes ?? null,
      teacherId: dto.teacherId ?? null,
      recurringDepositAmount: dto.recurringDepositAmount ?? null,
    });

    const saved = await this.fixedRepo.save(fixed);

    const generated = await this.generateBookings(saved, court, user);
    this.logger.log(`Turno fijo ${saved.id} creado. Turnos generados: ${generated}.`);

    return this.findOne(saved.id);
  }

  /**
   * Actualiza un turno fijo con cascada opcional a las instancias futuras.
   *
   * Si el DTO toca propiedades estructurales (dayOfWeek, hour, durationMinutes, courtId),
   * se ejecuta una cascada dentro de una transacción:
   *   1. Se eliminan los Bookings futuros con estado 'booked' y SIN pago registrado.
   *      Los que ya tienen pago se conservan intactos para no romper la contabilidad.
   *   2. Se regeneran los Bookings futuros con los nuevos datos.
   *
   * Si solo cambian datos no-estructurales (clientName, notes, etc.), la cascada se omite.
   */
  async update(id: string, dto: UpdateFixedBookingDto, user: User): Promise<FixedBooking> {
    const fixed = await this.findOne(id);
    const wasInactive = !fixed.isActive;

    if (dto.courtId !== undefined && dto.courtId !== fixed.courtId) {
      const newCourt = await this.courtRepo.findOne({ where: { id: dto.courtId } });
      if (!newCourt) throw new NotFoundException(`Cancha con ID ${dto.courtId} no encontrada.`);
      if (!newCourt.isActive)
        throw new BadRequestException('No se pueden asignar turnos a una cancha inactiva.');
    }

    const structuralChange =
      (dto.dayOfWeek !== undefined && dto.dayOfWeek !== fixed.dayOfWeek) ||
      (dto.hour !== undefined && dto.hour !== fixed.hour) ||
      (dto.durationMinutes !== undefined && dto.durationMinutes !== fixed.durationMinutes) ||
      (dto.courtId !== undefined && dto.courtId !== fixed.courtId);

    if (structuralChange) {
      const newCourtId = dto.courtId ?? fixed.courtId;
      const newDay = dto.dayOfWeek ?? fixed.dayOfWeek;
      const newHour = dto.hour ?? fixed.hour;
      const newDuration = dto.durationMinutes ?? fixed.durationMinutes;
      await this.checkFixedOverlap(newCourtId, newDay, newHour, newDuration, id);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      Object.assign(fixed, {
        ...(dto.clientName !== undefined && { clientName: dto.clientName }),
        ...(dto.phoneNumber !== undefined && { phoneNumber: dto.phoneNumber }),
        ...(dto.dayOfWeek !== undefined && { dayOfWeek: dto.dayOfWeek }),
        ...(dto.hour !== undefined && { hour: dto.hour }),
        ...(dto.durationMinutes !== undefined && { durationMinutes: dto.durationMinutes }),
        ...(dto.courtId !== undefined && { courtId: dto.courtId }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.teacherId !== undefined && { teacherId: dto.teacherId ?? null }),
        ...(dto.recurringDepositAmount !== undefined && {
          recurringDepositAmount: dto.recurringDepositAmount ?? null,
        }),
      });

      const saved = await queryRunner.manager.save(FixedBooking, fixed);

      if (structuralChange) {
        const today = this.localDateStr();

        const toDelete = await queryRunner.manager
          .createQueryBuilder(Booking, 'b')
          .leftJoin('b.payment', 'payment')
          .where('b.fixed_booking_id = :id', { id })
          .andWhere('b.date > :today', { today })
          .andWhere('b.status = :status', { status: BookingStatus.BOOKED })
          .andWhere(
            '(payment.id IS NULL OR (payment.amount_cash = 0 AND payment.amount_transfer = 0))',
          )
          .getMany();

        if (toDelete.length > 0) {
          const ids = toDelete.map((b) => b.id);
          await queryRunner.manager
            .createQueryBuilder()
            .delete()
            .from(Booking)
            .whereInIds(ids)
            .execute();

          this.logger.log(
            `Cascada turno fijo ${id}: eliminados ${ids.length} booking(s) futuros sin pago.`,
          );
        }

        const court = await queryRunner.manager.findOne(Court, { where: { id: saved.courtId } });
        if (court) {
          const dates = this.getNextOccurrences(
            saved.startDate,
            saved.dayOfWeek,
            WEEKS_TO_GENERATE,
          );
          const jsDayOfWeek = saved.dayOfWeek === 7 ? 0 : saved.dayOfWeek;
          const { amount: priceAmount, shiftName: appliedShiftName } =
            await this.calculateDynamicPrice(jsDayOfWeek, saved.hour, saved.durationMinutes);

          let regenerated = 0;
          for (const date of dates) {
            const existing = await queryRunner.manager.findOne(Booking, {
              where: { courtId: saved.courtId, date, hour: saved.hour },
            });
            if (existing && existing.status !== BookingStatus.CANCELLED) {
              this.logger.warn(
                `Cascada: slot ocupado ${saved.courtId} ${date} ${saved.hour} (status=${existing.status}) — omitido.`,
              );
              continue;
            }

            const booking = queryRunner.manager.create(Booking, {
              courtId: saved.courtId,
              date,
              hour: saved.hour,
              clientName: saved.clientName,
              durationMinutes: saved.durationMinutes,
              priceType: saved.teacherId ? PriceType.PROFESSOR : PriceType.STANDARD,
              priceAmount,
              appliedShiftName,
              status: BookingStatus.BOOKED,
              createdByUserId: user.id,
              fixedBookingId: saved.id,
              teacherId: saved.teacherId ?? null,
              expectedDepositAmount: saved.recurringDepositAmount ?? null,
            });

            try {
              await queryRunner.manager.save(Booking, booking);
              regenerated++;
            } catch (err: any) {
              if (err?.code === '23505') {
                this.logger.warn(`Cascada: conflicto al insertar ${date} ${saved.hour} — omitido.`);
              } else {
                throw err;
              }
            }
          }

          this.logger.log(`Cascada turno fijo ${id}: regenerados ${regenerated} booking(s).`);
        }
      } else if (wasInactive && saved.isActive) {
        const court = await queryRunner.manager.findOne(Court, { where: { id: saved.courtId } });
        if (court) {
          const generated = await this.generateBookings(saved, court, user);
          this.logger.log(`Turno fijo ${id} reactivado. Turnos generados: ${generated}.`);
        }
      }

      await queryRunner.commitTransaction();
      return this.findOne(id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `ROLLBACK en actualización del turno fijo ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Desactiva un turno fijo (soft-delete).
   * Los Booking individuales ya creados no se cancelan automáticamente.
   */
  async deactivate(id: string): Promise<void> {
    const fixed = await this.findOne(id);
    fixed.isActive = false;
    await this.fixedRepo.save(fixed);
  }

  /**
  /**
   * Borrado en cascada dentro de una transacción atómica.
   *
   * Elimina:
   *   - Los Bookings futuros (date >= hoy) con estado 'booked' y SIN pago registrado.
   *   - El FixedBooking padre.
   *
   * Preserva:
   *   - Bookings pasados (historial contable intacto).
   *   - Bookings con pago (cash > 0 o transfer > 0): el admin los resuelve manualmente.
   *   - Bookings con estado playing/completed/cancelled.
   *
   * Si algo falla, el ROLLBACK garantiza que no se borre nada parcialmente.
   * Retorna cuántas instancias futuras fueron eliminadas y cuántas fueron preservadas por tener pago.
   */
  async deleteCascade(id: string): Promise<{ deleted: number; preserved: number }> {
    await this.findOne(id);

    const today = this.localDateStr();

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const withoutPayment = await queryRunner.manager
        .createQueryBuilder(Booking, 'b')
        .leftJoin('b.payment', 'payment')
        .where('b.fixed_booking_id = :id', { id })
        .andWhere('b.date >= :today', { today })
        .andWhere('b.status = :status', { status: BookingStatus.BOOKED })
        .andWhere(
          '(payment.id IS NULL OR (payment.amount_cash = 0 AND payment.amount_transfer = 0))',
        )
        .getMany();

      const withPayment = await queryRunner.manager
        .createQueryBuilder(Booking, 'b')
        .leftJoin('b.payment', 'payment')
        .where('b.fixed_booking_id = :id', { id })
        .andWhere('b.date >= :today', { today })
        .andWhere('b.status = :status', { status: BookingStatus.BOOKED })
        .andWhere(
          'payment.id IS NOT NULL AND (payment.amount_cash > 0 OR payment.amount_transfer > 0)',
        )
        .getCount();

      if (withoutPayment.length > 0) {
        await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from(Booking)
          .whereInIds(withoutPayment.map((b) => b.id))
          .execute();
      }

      if (withPayment > 0) {
        await queryRunner.manager
          .createQueryBuilder()
          .update(Booking)
          .set({ fixedBookingId: null })
          .where('fixed_booking_id = :id', { id })
          .andWhere('date >= :today', { today })
          .execute();
      }

      await queryRunner.manager.delete(FixedBooking, { id });

      await queryRunner.commitTransaction();

      this.logger.log(
        `Turno fijo ${id} eliminado. Reservas borradas: ${withoutPayment.length}. Preservadas (con pago): ${withPayment}.`,
      );

      return { deleted: withoutPayment.length, preserved: withPayment };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`ROLLBACK en borrado de turno fijo ${id}: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Genera manualmente los Booking individuales para las próximas semanas.
   * Útil si se agregó un turno fijo sin fecha de inicio futura suficiente.
   */
  async generateNext(id: string, user: User): Promise<{ generated: number }> {
    const fixed = await this.findOne(id);
    const court = await this.courtRepo.findOne({ where: { id: fixed.courtId } });
    if (!court) {
      throw new NotFoundException(`Cancha del turno fijo no encontrada.`);
    }
    const generated = await this.generateBookings(fixed, court, user);
    return { generated };
  }

  /**
   * Genera Booking individuales para las próximas WEEKS_TO_GENERATE semanas
   * a partir de `startDate` (o hoy si ya pasó).
   * Salta las fechas que ya tienen un booking activo en el mismo slot.
   * Retorna la cantidad de bookings insertados.
   */
  private async generateBookings(fixed: FixedBooking, court: Court, user: User): Promise<number> {
    const dates = this.getNextOccurrences(fixed.startDate, fixed.dayOfWeek, WEEKS_TO_GENERATE);

    const jsDayOfWeek = fixed.dayOfWeek === 7 ? 0 : fixed.dayOfWeek;
    const { amount: priceAmount, shiftName: appliedShiftName } = await this.calculateDynamicPrice(
      jsDayOfWeek,
      fixed.hour,
      fixed.durationMinutes,
    );

    let created = 0;
    for (const date of dates) {
      const existing = await this.bookingRepo.findOne({
        where: { courtId: fixed.courtId, date, hour: fixed.hour },
        withDeleted: false,
      });
      if (existing && existing.status !== BookingStatus.CANCELLED) {
        this.logger.warn(
          `Slot ocupado: cancha=${fixed.courtId} fecha=${date} hora=${fixed.hour} (status=${existing.status}) — omitido.`,
        );
        continue;
      }

      const booking = this.bookingRepo.create({
        courtId: fixed.courtId,
        date,
        hour: fixed.hour,
        clientName: fixed.clientName,
        durationMinutes: fixed.durationMinutes,
        priceType: fixed.teacherId ? PriceType.PROFESSOR : PriceType.STANDARD,
        priceAmount,
        appliedShiftName,
        status: BookingStatus.BOOKED,
        createdByUserId: user.id,
        fixedBookingId: fixed.id,
        teacherId: fixed.teacherId ?? null,
        expectedDepositAmount: fixed.recurringDepositAmount ?? null,
      });

      try {
        await this.bookingRepo.save(booking);
        created++;
      } catch (err: any) {
        if (err?.code === '23505') {
          this.logger.warn(`Conflicto al insertar slot ${date} ${fixed.hour} — omitido.`);
        } else {
          throw err;
        }
      }
    }

    return created;
  }

  /**
   * Calcula las próximas `count` fechas que caen en `dayOfWeek` (1=Lun…7=Dom)
   * a partir de `startDate` (inclusive si aún no pasó) o desde hoy si startDate ya pasó.
   */
  private getNextOccurrences(startDate: string, dayOfWeek: number, count: number): string[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(startDate + 'T00:00:00');
    const base = start > today ? start : today;

    const isoToJs = (d: number) => (d === 7 ? 0 : d);
    const target = isoToJs(dayOfWeek);
    const current = new Date(base);

    let daysAhead = (target - current.getDay() + 7) % 7;
    if (daysAhead === 0 && current.getDay() !== target) daysAhead = 7;
    current.setDate(current.getDate() + daysAhead);

    const results: string[] = [];
    for (let i = 0; i < count; i++) {
      results.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 7);
    }
    return results;
  }

  /** Fecha de hoy en formato YYYY-MM-DD usando hora local (UTC-3 safe). */
  private localDateStr(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Calcula el precio del turno usando el mismo motor de franjas horarias que bookings.service.ts.
   * @param dayOfWeek  - Día de la semana en formato JS Date.getDay() (0=Dom, 1=Lun, …, 6=Sáb).
   * @param hour       - Hora del turno en formato 'HH:mm'.
   * @param duration   - Duración en minutos (30, 60, 90, 120).
   */
  private async calculateDynamicPrice(
    dayOfWeek: number,
    hour: string,
    duration: number,
  ): Promise<{ amount: number; shiftName: string }> {
    const [h, m] = hour.split(':').map(Number);
    const bookingMin = h * 60 + m;

    const shifts = await this.shiftRepo.find({ where: { isActive: true } });

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
      this.logger.log(
        `Precio turno fijo: franja "${matching.name}" → $${base} (${duration}min, día=${dayOfWeek}, hora=${hour})`,
      );
      return { amount: base, shiftName: matching.name };
    }

    this.logger.warn(`Sin franja horaria para día=${dayOfWeek} hora=${hour}. Precio = 0.`);
    return { amount: 0, shiftName: 'Estándar' };
  }
}
