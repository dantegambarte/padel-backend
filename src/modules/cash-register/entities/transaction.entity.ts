import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { CashSession } from './cash-session.entity';
import { User } from '../../users/entities/user.entity';

export enum TransactionType {
  BOOKING = 'booking', // Pago de turno desde Agenda
  SALE = 'sale', // Venta desde POS
}

/**
 * Movimiento de caja unificado.
 * Toda entrada de dinero (booking o sale) genera un registro aquí.
 * Este es el origen de verdad para el arqueo de caja.
 *
 * reference_id apunta al booking.id o sale.id según el tipo,
 * lo que permite trazabilidad completa.
 */
@Entity('transactions')
@Index('IDX_transaction_session', ['cashSessionId'])
@Index('IDX_transaction_type_ref', ['type', 'referenceId'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CashSession, (session) => session.transactions, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'cash_session_id' })
  cashSession: CashSession;

  @Column({ name: 'cash_session_id', type: 'uuid' })
  cashSessionId: string;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  /**
   * UUID del booking o sale que originó esta transacción.
   * Permite hacer JOIN para mostrar detalle en el historial de caja.
   */
  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string;

  /**
   * Descripción legible para el historial.
   * Ej: "Turno Cancha 2 - 15:00hs (Carlos Rodríguez)"
   *     "Venta cantina - 3 productos"
   */
  @Column({ type: 'varchar', length: 255 })
  concept: string;

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

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: User;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
