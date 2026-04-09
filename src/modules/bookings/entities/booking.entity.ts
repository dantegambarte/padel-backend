import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Court } from '../../courts/entities/court.entity';
import { User } from '../../users/entities/user.entity';
import { BookingItem } from './booking-item.entity';
import { BookingPayment } from './booking-payment.entity';
import { FixedBooking } from '../../fixed-bookings/entities/fixed-booking.entity';
import { Teacher } from '../../teachers/entities/teacher.entity';

export enum BookingStatus {
  BOOKED = 'booked',
  PLAYING = 'playing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum PriceType {
  STANDARD = 'standard',
  PROFESSOR = 'professor',
}

/**
 * CONSTRAINT ANTI-OVERBOOKING:
 * La combinación (court_id + date + hour) debe ser única.
 * Además, en el servicio usaremos SELECT FOR UPDATE para manejar
 * condiciones de carrera ante peticiones concurrentes.
 */
@Entity('bookings')
@Index('IDX_booking_date', ['date'])
@Index('IDX_booking_court_date', ['courtId', 'date'])
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Court, (court) => court.bookings, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'court_id' })
  court: Court;

  @Column({ name: 'court_id', type: 'uuid' })
  courtId: string;

  /**
   * Fecha del turno (solo la fecha, sin hora).
   * La hora se guarda por separado para facilitar queries por grilla.
   */
  @Column({ type: 'date' })
  date: string;

  /**
   * Franja horaria en formato "HH:MM" (ej: "09:00", "15:00").
   * Cada slot representa 1 hora.
   */
  @Column({ type: 'varchar', length: 5 })
  hour: string;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    default: BookingStatus.BOOKED,
  })
  status: BookingStatus;

  @Column({ name: 'client_name', type: 'varchar', length: 150 })
  clientName: string;

  @Column({
    name: 'price_type',
    type: 'enum',
    enum: PriceType,
    default: PriceType.STANDARD,
  })
  priceType: PriceType;

  /**
   * Nombre de la franja horaria aplicada al calcular el precio (ej. 'Turno Tarde').
   * Se persiste como snapshot en el momento de la reserva para que cambios futuros
   * en las franjas no afecten la etiqueta mostrada en el modal de cobro.
   * null para reservas históricas creadas antes de esta columna.
   */
  @Column({
    name: 'applied_shift_name',
    type: 'varchar',
    length: 100,
    nullable: true,
    default: null,
  })
  appliedShiftName: string | null;

  /**
   * Precio de la cancha al momento de la reserva.
   * Se guarda como snapshot para que cambios futuros en configuración
   * no afecten reservas históricas.
   */
  @Column({
    name: 'price_amount',
    type: 'numeric',
    precision: 10,
    scale: 2,
  })
  priceAmount: number;

  /** Duración del turno en minutos. 60 = un slot estándar. */
  @Column({ name: 'duration_minutes', type: 'int', default: 60 })
  durationMinutes: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: User;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => BookingItem, (item) => item.booking, {
    cascade: false,
    eager: false,
  })
  items: BookingItem[];

  @OneToOne(() => BookingPayment, (payment) => payment.booking, {
    cascade: false,
    eager: false,
  })
  payment: BookingPayment;

  /**
   * FK nullable al turno fijo que originó este turno.
   * null cuando el turno fue creado manualmente.
   */
  @Column({ name: 'fixed_booking_id', type: 'uuid', nullable: true })
  fixedBookingId: string | null;

  @ManyToOne(() => FixedBooking, { nullable: true, onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'fixed_booking_id' })
  fixedBooking: FixedBooking | null;

  /**
   * Indica si el cliente confirmó su asistencia al turno fijo.
   * Solo aplica para turnos con fixedBookingId != null.
   * El admin lo marca desde el modal de detalle tras contactar al cliente por WA.
   */
  @Column({ name: 'is_confirmed', type: 'boolean', default: false })
  isConfirmed: boolean;

  /**
   * Monto de seña esperada por transferencia, heredado del turno fijo.
   * Presente solo en bookings generados a partir de un FixedBooking con
   * `recurringDepositAmount > 0`. El pago NO se aplica hasta que el admin
   * llame al endpoint confirm-expected-deposit.
   * null cuando el turno fue creado manualmente o no tiene seña recurrente.
   */
  @Column({
    name: 'expected_deposit_amount',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    default: null,
  })
  expectedDepositAmount: number | null;

  /**
   * FK nullable al profesor vinculado a este turno.
   * Cuando está presente el priceType suele ser 'professor'.
   */
  @Column({ name: 'teacher_id', type: 'uuid', nullable: true })
  teacherId: string | null;

  @ManyToOne(() => Teacher, { nullable: true, onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'teacher_id' })
  teacher: Teacher | null;
}
