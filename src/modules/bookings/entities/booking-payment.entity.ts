import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Booking } from './booking.entity';

/**
 * Registro de pago asociado a una reserva.
 * Relación 1-a-1 con Booking.
 *
 * Los valores se suman para obtener el total pagado:
 *   totalPaid = amountCash + amountTransfer
 *
 * Si totalPaid < booking.priceAmount + items.total → turno con seña (saldo pendiente).
 * Si totalPaid === total → turno completamente pagado.
 */
@Entity('booking_payments')
export class BookingPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Booking, (booking) => booking.payment, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @Column({
    name: 'amount_cash',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  amountCash: number;

  @Column({
    name: 'amount_transfer',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  amountTransfer: number;

  @Column({ name: 'player_payment_details', type: 'jsonb', nullable: true, default: null })
  playerPaymentDetails:
    | {
        method: 'cash' | 'transfer';
        amount: number;
        courtAmount: number;
        consumablesTotal: number;
        consumableItems: { name: string; unitPrice: number; qty: number }[];
      }[]
    | null;

  @CreateDateColumn({ name: 'paid_at' })
  paidAt: Date;
}
