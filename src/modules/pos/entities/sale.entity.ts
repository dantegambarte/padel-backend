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
import { CashSession } from '../../cash-register/entities/cash-session.entity';
import { SaleItem } from './sale-item.entity';

export enum SaleStatus {
  OPEN = 'open',
  PAID = 'paid',
}

/**
 * Venta realizada desde el POS (mostrador).
 * Al confirmarse, en una transacción DB atómica se:
 *   1. Crea este registro.
 *   2. Crean los SaleItems.
 *   3. Decrementa el stock de cada producto.
 *   4. Crea un Transaction en la sesión de caja activa.
 */
@Entity('sales')
export class Sale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CashSession, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cash_session_id' })
  cashSession: CashSession;

  @Column({ name: 'cash_session_id', type: 'uuid' })
  cashSessionId: string;

  @ManyToOne(() => User, (user) => user.sales, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: User;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string;

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

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  total: number;

  /** Nombre del cliente (opcional). Se muestra en la comanda de consumo. */
  @Column({ name: 'customer_name', type: 'varchar', length: 100, nullable: true })
  customerName: string | null;

  /**
   * Estado de la venta. 'open' = cuenta abierta (torneos/jornadas): el stock
   * ya se descontó pero el cobro queda pendiente. 'paid' = venta cobrada,
   * flujo tradicional del POS (default, retrocompatible).
   */
  @Column({
    type: 'enum',
    enum: SaleStatus,
    default: SaleStatus.PAID,
  })
  status: SaleStatus;

  /**
   * Clave de idempotencia del frontend (X-Idempotency-Key header).
   * UUID único generado por cada intento de venta. Si el backend recibe
   * un POST con una clave ya registrada, retorna la venta existente sin
   * volver a descontar stock ni registrar en caja (protección anti-duplicado).
   */
  @Column({
    name: 'idempotency_key',
    type: 'uuid',
    nullable: true,
    unique: true,
  })
  idempotencyKey: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => SaleItem, (item) => item.sale, {
    cascade: ['insert'],
    eager: true,
  })
  items: SaleItem[];
}
