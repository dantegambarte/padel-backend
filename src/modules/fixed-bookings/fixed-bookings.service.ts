import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
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
   * Crea un turno fijo y genera automáticamente los Booking individuales
   * para las próximas {@link WEEKS_TO_GENERATE} semanas.
   */
  async create(dto: CreateFixedBookingDto, user: User): Promise<FixedBooking> {
    const court = await this.courtRepo.findOne({ where: { id: dto.courtId } });
    if (!court) {
      throw new NotFoundException(`Cancha con ID ${dto.courtId} no encontrada.`);
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
    });

    const saved = await this.fixedRepo.save(fixed);

    const generated = await this.generateBookings(saved, court, user);
    this.logger.log(`Turno fijo ${saved.id} creado. Turnos generados: ${generated}.`);

    return this.findOne(saved.id);
  }

  /**
   * Actualiza un turno fijo. Si se reactiva (isActive: true desde false),
   * genera los turnos pendientes de las próximas semanas.
   */
  async update(id: string, dto: UpdateFixedBookingDto, user: User): Promise<FixedBooking> {
    const fixed = await this.findOne(id);
    const wasInactive = !fixed.isActive;

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
    });

    const saved = await this.fixedRepo.save(fixed);

    if (wasInactive && saved.isActive) {
      const court = await this.courtRepo.findOne({ where: { id: saved.courtId } });
      if (court) {
        const generated = await this.generateBookings(saved, court, user);
        this.logger.log(`Turno fijo ${id} reactivado. Turnos generados: ${generated}.`);
      }
    }

    return this.findOne(id);
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
   * Borrado en cascada: elimina todas las reservas individuales futuras
   * con estado 'booked' asociadas al turno fijo, luego elimina el turno fijo.
   * Las reservas pasadas o en curso no se tocan.
   */
  async deleteCascade(id: string): Promise<{ deleted: number }> {
    await this.findOne(id);

    const today = this.localDateStr();

    const result = await this.bookingRepo
      .createQueryBuilder()
      .delete()
      .from(Booking)
      .where('fixed_booking_id = :id', { id })
      .andWhere('date >= :today', { today })
      .andWhere('status = :status', { status: BookingStatus.BOOKED })
      .execute();

    await this.fixedRepo.delete(id);

    const deleted = result.affected ?? 0;
    this.logger.log(
      `Turno fijo ${id} eliminado en cascada. Reservas futuras borradas: ${deleted}.`,
    );
    return { deleted };
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
      });
      if (existing) {
        this.logger.warn(
          `Slot ocupado: cancha=${fixed.courtId} fecha=${date} hora=${fixed.hour} — omitido.`,
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
