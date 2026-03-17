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
  Unique,
  Index,
} from 'typeorm';
import { Court } from '../../courts/entities/court.entity';
import { User } from '../../users/entities/user.entity';
import { BookingItem } from './booking-item.entity';
import { BookingPayment } from './booking-payment.entity';

export enum BookingStatus {
  BOOKED = 'booked', // Reservado (con o sin seña)
  PLAYING = 'playing', // Jugando actualmente
  COMPLETED = 'completed', // Turno finalizado
  CANCELLED = 'cancelled', // Cancelado (solo admin)
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
@Unique('UQ_booking_court_date_hour', ['courtId', 'date', 'hour'])
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
  date: string; // "2025-03-15"

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

  // ── Relaciones ───────────────────────────────────────
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
}
