import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Transaction } from './transaction.entity';

export enum CashSessionStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

/**
 * Sesión de caja diaria.
 * Solo puede existir UNA sesión por fecha (UNIQUE en 'date').
 *
 * La sesión se abre automáticamente al primer movimiento del día
 * (primera reserva o primera venta). Se cierra manualmente con
 * el "Cierre Z" que bloquea el día.
 *
 * cash_expected = Σ amount_cash de todas las transactions del día.
 * transfer_total = Σ amount_transfer de todas las transactions del día.
 * Estos valores se recalculan en tiempo real al consultar la sesión.
 *
 * cash_counted = efectivo físico contado al cierre (ingresado por el empleado).
 * difference = cash_counted - cash_expected (positivo = sobrante, negativo = faltante).
 */
@Entity('cash_sessions')
@Unique('UQ_cash_session_date', ['date'])
export class CashSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Fecha de la sesión en formato ISO (sin hora): "2025-03-15"
   */
  @Column({ type: 'date' })
  date: string;

  @Column({
    type: 'enum',
    enum: CashSessionStatus,
    default: CashSessionStatus.OPEN,
  })
  status: CashSessionStatus;

  @ManyToOne(() => User, (user) => user.openedSessions, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'opened_by_user_id' })
  openedByUser: User;

  @Column({ name: 'opened_by_user_id', type: 'uuid', nullable: true })
  openedByUserId: string;

  @ManyToOne(() => User, (user) => user.closedSessions, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'closed_by_user_id' })
  closedByUser: User;

  @Column({ name: 'closed_by_user_id', type: 'uuid', nullable: true })
  closedByUserId: string;

  /**
   * Efectivo físico contado al cierre. Null si la sesión está abierta.
   */
  @Column({
    name: 'cash_counted',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  cashCounted: number;

  /**
   * cash_counted - cash_expected. Se calcula y persiste en el cierre Z.
   */
  @Column({
    name: 'difference',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  difference: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn({ name: 'opened_at' })
  openedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date;

  @OneToMany(() => Transaction, (tx) => tx.cashSession, {
    eager: false,
  })
  transactions: Transaction[];
}
