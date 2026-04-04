import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CashSession } from '../../cash-register/entities/cash-session.entity';
import { User } from '../../users/entities/user.entity';

/** Métodos de pago admitidos para un egreso. */
export enum PaymentMethod {
  CASH     = 'Efectivo',
  TRANSFER = 'Transferencia',
  CARD     = 'Tarjeta',
  OTHER    = 'Otro',
}

/** Categorías predefinidas de egresos. */
export enum ExpenseCategory {
  SUPPLIES    = 'Insumos',
  MAINTENANCE = 'Mantenimiento',
  SALARY      = 'Sueldos',
  SERVICES    = 'Servicios',
  OTHER       = 'Otro',
}

@Entity('expenses')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Monto del egreso (positivo). */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'enum', enum: ExpenseCategory, default: ExpenseCategory.OTHER })
  category: ExpenseCategory;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
    default: PaymentMethod.CASH,
  })
  paymentMethod: PaymentMethod;

  /** Fecha comercial del egreso (YYYY-MM-DD). */
  @Column({ type: 'date' })
  date: string;

  /**
   * Sesión de caja activa al momento del registro del egreso.
   * Solo se vincula cuando paymentMethod === 'Efectivo'.
   */
  @ManyToOne(() => CashSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cash_session_id' })
  cashSession: CashSession | null;

  @Column({ name: 'cash_session_id', type: 'uuid', nullable: true })
  cashSessionId: string | null;

  /** Usuario que registró el egreso (para auditoría y RBAC). */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: User | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /** Soft delete: el registro no se elimina físicamente. */
  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
