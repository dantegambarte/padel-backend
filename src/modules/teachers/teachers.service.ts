import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Teacher } from './entities/teacher.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { PricingShift } from '../pricing-shifts/entities/pricing-shift.entity';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';

@Injectable()
export class TeachersService {
  constructor(
    @InjectRepository(Teacher)
    private readonly teacherRepo: Repository<Teacher>,

    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,

    @InjectRepository(PricingShift)
    private readonly shiftRepo: Repository<PricingShift>,
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

  async findOne(id: string): Promise<Teacher> {
    const teacher = await this.teacherRepo.findOne({ where: { id } });
    if (!teacher) {
      throw new NotFoundException(`Profesor con id "${id}" no encontrado`);
    }
    return teacher;
  }

  create(dto: CreateTeacherDto): Promise<Teacher> {
    const teacher = this.teacherRepo.create({
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber ?? null,
    });
    return this.teacherRepo.save(teacher);
  }

  async update(id: string, dto: UpdateTeacherDto): Promise<Teacher> {
    const teacher = await this.findOne(id);

    if (dto.fullName    !== undefined) teacher.fullName    = dto.fullName;
    if (dto.phoneNumber !== undefined) teacher.phoneNumber = dto.phoneNumber ?? null;
    if (dto.isActive    !== undefined) teacher.isActive    = dto.isActive;

    return this.teacherRepo.save(teacher);
  }

  /** Soft-delete: marca isActive = false. */
  async deactivate(id: string): Promise<void> {
    const teacher = await this.findOne(id);
    teacher.isActive = false;
    await this.teacherRepo.save(teacher);
  }

  /**
   * Resuelve el teacherPricePerHour de la franja activa para una fecha/hora dada.
   * Misma lógica que bookings.service.ts: día de semana local + comparación de minutos.
   */
  private resolveTeacherPrice(date: string, hour: string, shifts: PricingShift[]): number {
    const [year, month, day] = date.split('-').map(Number);
    const dayOfWeek = new Date(year, month - 1, day).getDay(); // 0=Dom…6=Sáb
    const [h, m] = hour.split(':').map(Number);
    const bookingMin = h * 60 + m;

    const matching = shifts.find((s) => {
      const days = (s.daysOfWeek as any[]).map(Number);
      if (!days.includes(dayOfWeek)) return false;
      const [sh, sm] = s.startTime.split(':').map(Number);
      const [eh, em] = s.endTime.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin   = eh * 60 + em;
      return startMin <= endMin
        ? bookingMin >= startMin && bookingMin < endMin
        : bookingMin >= startMin || bookingMin < endMin; // franja que cruza medianoche
    });

    return matching ? Number(matching.teacherPricePerHour) : 0;
  }

  /**
   * Genera el reporte de liquidación de un profesor en un rango de fechas.
   * - Cada turno cuenta siempre como 1 hora (el profesor trabaja 1h por turno).
   * - El importe por turno se obtiene de teacherPricePerHour de la franja activa
   *   que corresponde al día y hora del turno (no del priceAmount del booking).
   */
  async getReport(id: string, startDate: string, endDate: string) {
    if (!startDate || !endDate) {
      throw new BadRequestException('Los parámetros startDate y endDate son obligatorios.');
    }

    const [teacher, shifts, bookings] = await Promise.all([
      this.findOne(id),
      this.shiftRepo.find({ where: { isActive: true } }),
      this.bookingRepo
        .createQueryBuilder('booking')
        .leftJoinAndSelect('booking.court', 'court')
        .where('booking.teacherId = :id', { id })
        .andWhere('booking.status = :status', { status: BookingStatus.COMPLETED })
        .andWhere('booking.date BETWEEN :startDate AND :endDate', { startDate, endDate })
        .orderBy('booking.date', 'ASC')
        .addOrderBy('booking.hour', 'ASC')
        .getMany(),
    ]);

    const mappedBookings = bookings.map((b) => {
      const teacherAmount = this.resolveTeacherPrice(b.date, b.hour, shifts);
      return {
        id: b.id,
        date: b.date,
        hour: b.hour,
        durationMinutes: 60, // el profesor siempre trabaja 1h por turno
        courtName: b.court?.name ?? '—',
        teacherAmount,
      };
    });

    const totalMinutes = mappedBookings.length * 60;
    const totalAmount  = mappedBookings.reduce((sum, b) => sum + b.teacherAmount, 0);

    return {
      teacher,
      period: { startDate, endDate },
      bookings: mappedBookings,
      summary: {
        totalBookings: mappedBookings.length,
        totalMinutes,
        totalHours: +(totalMinutes / 60).toFixed(2),
        totalAmount,
      },
    };
  }
}
