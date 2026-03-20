import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Transaction } from './transaction.entity';

export enum CashSessionStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

/**
 * Sesión de caja / jornada de trabajo.
 * Pueden existir múltiples sesiones por fecha (turno mañana, turno tarde, etc.).
 * La única restricción es que solo puede haber UNA sesión con status OPEN a la vez.
 *
 * La sesión se abre manualmente antes de registrar cobros.
 * Se cierra con el "Cierre Z". Tras el cierre se puede abrir una nueva jornada.
 *
 * cash_expected = Σ amount_cash de todas las transactions de la sesión.
 * transfer_total = Σ amount_transfer de todas las transactions de la sesión.
 *
 * cash_counted = efectivo físico contado al cierre (ingresado por el empleado).
 * difference = cash_counted - cash_expected (positivo = sobrante, negativo = faltante).
 */
@Entity('cash_sessions')
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

  /**
   * Fondo de caja / cambio inicial declarado por el empleado al abrir la sesión.
   * No entra en el arqueo de efectivo (es solo referencia operativa).
   */
  @Column({
    name: 'initial_balance',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  initialBalance: number;

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
