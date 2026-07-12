import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Teacher } from './entities/teacher.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { PricingShift } from '../pricing-shifts/entities/pricing-shift.entity';
import {
  InternalConsumption,
  InternalConsumptionStatus,
} from '../internal-consumption/entities/internal-consumption.entity';
import { Transaction, TransactionType } from '../cash-register/entities/transaction.entity';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { LiquidateTeacherDto, PaymentMethod } from './dto/liquidate-teacher.dto';

@Injectable()
export class TeachersService {
  private readonly logger = new Logger(TeachersService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(Teacher)
    private readonly teacherRepo: Repository<Teacher>,

    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,

    @InjectRepository(PricingShift)
    private readonly shiftRepo: Repository<PricingShift>,

    @InjectRepository(InternalConsumption)
    private readonly consumptionRepo: Repository<InternalConsumption>,

    private readonly cashRegisterService: CashRegisterService,
  ) {}

  /**
   * Lista profesores ordenados alfabéticamente.
   * @param includeInactive - `false` (por defecto): solo activos.
   *                          `true`: activos e inactivos (uso exclusivo de admin).
   */
  findAll(includeInactive = false): Promise<Teacher[]> {
    return this.teacherRepo.find({
      where: includeInactive ? undefined : { isActive: true },
      order: { fullName: 'ASC' },
    });
  }

  /** Retorna un profesor por ID o lanza NotFoundException. */
  async findOne(id: string): Promise<Teacher> {
    const teacher = await this.teacherRepo.findOne({ where: { id } });
    if (!teacher) {
      throw new NotFoundException(`Profesor con id "${id}" no encontrado`);
    }
    return teacher;
  }

  /** Crea un nuevo profesor. */
  async create(dto: CreateTeacherDto): Promise<Teacher> {
    const teacher = this.teacherRepo.create({
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber ?? null,
    });
    const saved = await this.teacherRepo.save(teacher);
    this.logger.log(`Profesor creado: "${saved.fullName}" (id=${saved.id})`);
    return saved;
  }

  /** Actualiza parcialmente un profesor. */
  async update(id: string, dto: UpdateTeacherDto): Promise<Teacher> {
    const teacher = await this.findOne(id);

    if (dto.fullName !== undefined) teacher.fullName = dto.fullName;
    if (dto.phoneNumber !== undefined) teacher.phoneNumber = dto.phoneNumber ?? null;
    if (dto.isActive !== undefined) teacher.isActive = dto.isActive;

    const saved = await this.teacherRepo.save(teacher);
    this.logger.log(`Profesor actualizado: "${saved.fullName}" (id=${id})`);
    return saved;
  }

  /** Soft-delete: marca isActive = false. */
  async deactivate(id: string): Promise<void> {
    const teacher = await this.findOne(id);
    teacher.isActive = false;
    await this.teacherRepo.save(teacher);
    this.logger.log(`Profesor desactivado: "${teacher.fullName}" (id=${id})`);
  }

  /**
   * Resuelve el teacherPricePerHour de la franja activa para una fecha/hora dada.
   * Misma lógica que bookings.service.ts: día de semana local + comparación de minutos.
   */
  private resolveTeacherPrice(date: string, hour: string, shifts: PricingShift[]): number {
    const [year, month, day] = date.split('-').map(Number);
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    const [h, m] = hour.split(':').map(Number);
    const bookingMin = h * 60 + m;

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

    return matching ? Number(matching.teacherPricePerHour) : 0;
  }

  /**
   * Genera el reporte de liquidación de un profesor en un rango de fechas.
   * - El importe por turno usa teacherRateSnapshot (tarifa congelada al crear el turno).
   * - Solo si el snapshot es null (dato histórico previo a la feature) se cae al
   *   teacherPricePerHour de la franja activa como fallback de seguridad.
   */
  async getReport(id: string, startDate: string, endDate: string) {
    if (!startDate || !endDate) {
      throw new BadRequestException('Los parámetros startDate y endDate son obligatorios.');
    }

    const [teacher, shifts, bookings, pendingConsumptions] = await Promise.all([
      this.findOne(id),
      this.shiftRepo.find({ where: { isActive: true } }),
      this.bookingRepo
        .createQueryBuilder('booking')
        .leftJoinAndSelect('booking.court', 'court')
        .where('booking.teacherId = :id', { id })
        .andWhere('booking.status = :status', { status: BookingStatus.COMPLETED })
        .andWhere('booking.isSettled = false')
        .andWhere('booking.date BETWEEN :startDate AND :endDate', { startDate, endDate })
        .orderBy('booking.date', 'ASC')
        .addOrderBy('booking.hour', 'ASC')
        .getMany(),
      this.consumptionRepo.find({
        where: { teacherId: id, status: InternalConsumptionStatus.PENDING_PAYMENT },
        order: { date: 'ASC' },
      }),
    ]);

    const mappedBookings = bookings.map((b) => {
      if (b.teacherRateSnapshot === null || b.teacherRateSnapshot === undefined) {
        this.logger.warn(
          `[SNAPSHOT] Turno ${b.id} (${b.date} ${b.hour}) sin snapshot — usando tarifa actual de franja como fallback.`,
        );
      }
      const hourlyRate =
        b.teacherRateSnapshot !== null && b.teacherRateSnapshot !== undefined
          ? Number(b.teacherRateSnapshot)
          : this.resolveTeacherPrice(b.date, b.hour, shifts);
      const hours = (b.durationMinutes ?? 60) / 60;
      const teacherAmount = +(hourlyRate * hours).toFixed(2);
      return {
        id: b.id,
        date: b.date,
        hour: b.hour,
        durationMinutes: b.durationMinutes ?? 60,
        courtName: b.court?.name ?? '—',
        hourlyRate,
        teacherAmount,
      };
    });

    const totalMinutes = mappedBookings.reduce((sum, b) => sum + b.durationMinutes, 0);
    const totalAmount = mappedBookings.reduce((sum, b) => sum + b.teacherAmount, 0);

    const mappedConsumptions = pendingConsumptions.map((c) => {
      const totalCost = +(Number(c.unitCostPrice) * c.quantity).toFixed(2);
      return {
        id: c.id,
        date: c.date,
        productName: c.product?.name ?? '—',
        quantity: c.quantity,
        unitCostPrice: Number(c.unitCostPrice),
        totalCost,
        notes: c.notes,
      };
    });
    const consumptionsTotal = +mappedConsumptions.reduce((sum, c) => sum + c.totalCost, 0).toFixed(2);

    return {
      teacher,
      period: { startDate, endDate },
      bookings: mappedBookings,
      consumptions: mappedConsumptions,
      summary: {
        totalBookings: mappedBookings.length,
        totalMinutes,
        totalHours: +(totalMinutes / 60).toFixed(2),
        totalAmount,
        totalConsumptions: mappedConsumptions.length,
        consumptionsTotal,
        grandTotal: +(totalAmount + consumptionsTotal).toFixed(2),
      },
    };
  }

  /**
   * Liquidación unificada: marca los turnos del profesor como `isSettled = true`
   * y los consumos internos como `PAID`, registrando una única Transaction en caja.
   */
  async liquidate(
    dto: LiquidateTeacherDto,
    userId: string,
  ): Promise<{ settled: boolean; totalAmount: number }> {
    const teacher = await this.findOne(dto.teacherId);

    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.id IN (:...ids)', { ids: dto.bookingIds })
      .andWhere('b.teacherId = :tid', { tid: dto.teacherId })
      .andWhere('b.status = :status', { status: BookingStatus.COMPLETED })
      .andWhere('b.isSettled = false')
      .getMany();

    if (bookings.length !== dto.bookingIds.length) {
      throw new BadRequestException(
        'Uno o más turnos no son válidos para liquidar (ya liquidados, de otro profesor o no completados).',
      );
    }

    const shifts = await this.shiftRepo.find({ where: { isActive: true } });
    const bookingTotal = bookings.reduce((sum, b) => {
      const hourlyRate =
        b.teacherRateSnapshot !== null && b.teacherRateSnapshot !== undefined
          ? Number(b.teacherRateSnapshot)
          : this.resolveTeacherPrice(b.date, b.hour, shifts);
      return sum + +(hourlyRate * ((b.durationMinutes ?? 60) / 60)).toFixed(2);
    }, 0);

    // Validar consumos (puede ser array vacío)
    let consumptionTotal = 0;
    let consumptions: InternalConsumption[] = [];
    if (dto.consumptionIds.length > 0) {
      consumptions = await this.consumptionRepo
        .createQueryBuilder('c')
        .where('c.id IN (:...ids)', { ids: dto.consumptionIds })
        .andWhere('c.teacherId = :tid', { tid: dto.teacherId })
        .andWhere('c.status = :status', { status: InternalConsumptionStatus.PENDING_PAYMENT })
        .getMany();

      if (consumptions.length !== dto.consumptionIds.length) {
        throw new BadRequestException(
          'Uno o más consumos no son válidos para liquidar (ya pagados o de otro profesor).',
        );
      }

      consumptionTotal = consumptions.reduce(
        (sum, c) => sum + Number(c.unitCostPrice) * c.quantity,
        0,
      );
    }

    const totalAmount = +(bookingTotal + consumptionTotal).toFixed(2);

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const session = await this.cashRegisterService.getActiveSessionOrFail(qr, userId);

      if (bookings.length > 0) {
        await qr.manager.update(
          Booking,
          bookings.map((b) => b.id),
          { isSettled: true },
        );
      }

      if (consumptions.length > 0) {
        await qr.manager.update(
          InternalConsumption,
          consumptions.map((c) => c.id),
          { status: InternalConsumptionStatus.PAID },
        );
      }

      const tx = qr.manager.create(Transaction, {
        cashSessionId: session.id,
        type: TransactionType.SETTLEMENT,
        referenceId: dto.teacherId,
        concept: `Liquidación ${teacher.fullName} — ${bookings.length} turno(s)${consumptions.length > 0 ? ` + ${consumptions.length} consumo(s)` : ''}`,
        amountCash: dto.paymentMethod === PaymentMethod.CASH ? totalAmount : 0,
        amountTransfer: dto.paymentMethod === PaymentMethod.TRANSFER ? totalAmount : 0,
        createdByUserId: userId,
      });
      await qr.manager.save(Transaction, tx);

      await qr.commitTransaction();
      this.logger.log(
        `Liquidación ${teacher.fullName}: ${bookings.length} turno(s) + ${consumptions.length} consumo(s) = $${totalAmount} (${dto.paymentMethod}).`,
      );
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }

    return { settled: true, totalAmount };
  }
}
