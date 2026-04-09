import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { Court } from '../../courts/entities/court.entity';
import { Teacher } from '../../teachers/entities/teacher.entity';

/**
 * Representa un "turno fijo" o reserva recurrente semanal.
 * Un turno fijo genera automáticamente Booking individuales
 * para las próximas semanas cuando se crea o reactiva.
 */
@Entity('fixed_bookings')
@Index('IDX_fixed_booking_court_day_hour', ['courtId', 'dayOfWeek', 'hour'])
export class FixedBooking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_name', type: 'varchar', length: 150 })
  clientName: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 30, nullable: true })
  phoneNumber: string | null;

  /**
   * Día de la semana: 1 = Lunes … 7 = Domingo (ISO 8601).
   */
  @Column({ name: 'day_of_week', type: 'int' })
  dayOfWeek: number;

  /** Hora en formato "HH:MM", ej: "09:00". */
  @Column({ type: 'varchar', length: 5 })
  hour: string;

  @Column({ name: 'duration_minutes', type: 'int', default: 60 })
  durationMinutes: number;

  @ManyToOne(() => Court, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'court_id' })
  court: Court;

  @Column({ name: 'court_id', type: 'uuid' })
  courtId: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Fecha a partir de la cual empezar a generar turnos. */
  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /**
   * Monto de seña recurrente esperada por transferencia.
   * Si está definido, cada Booking generado por este turno fijo
   * nace con `expectedDepositAmount` igual a este valor.
   * El pago NO se registra automáticamente; requiere confirmación manual.
   */
  @Column({
    name: 'recurring_deposit_amount',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    default: null,
  })
  recurringDepositAmount: number | null;

  /** FK nullable al profesor vinculado a este turno fijo. */
  @Column({ name: 'teacher_id', type: 'uuid', nullable: true })
  teacherId: string | null;

  @ManyToOne(() => Teacher, { nullable: true, onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'teacher_id' })
  teacher: Teacher | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
