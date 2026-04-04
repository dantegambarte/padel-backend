import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Exclude } from 'class-transformer';

export enum UserRole {
  ADMIN = 'admin',
  EMPLOYEE = 'employee',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  username: string;

  @Column({ name: 'full_name', type: 'varchar', length: 100 })
  fullName: string;

  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar' })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.EMPLOYEE })
  role: UserRole;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Si es `true`, el usuario debe cambiar su contraseña en el próximo inicio de sesión. */
  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;

  /**
   * Versión de sesión activa. Se incrementa en cada login para invalidar
   * tokens emitidos en sesiones anteriores (single-session enforcement).
   */
  @Exclude()
  @Column({ name: 'session_version', type: 'int', default: 1 })
  sessionVersion: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ── Relaciones (inversas, para queries JOIN) ─────────
  // Se declaran acá para que TypeORM conozca el grafo completo.
  // No se usan directamente en la mayoría de los endpoints.
  @OneToMany('Booking', 'createdByUser')
  bookings: any[];

  @OneToMany('Sale', 'createdByUser')
  sales: any[];

  @OneToMany('CashSession', 'openedByUser')
  openedSessions: any[];

  @OneToMany('CashSession', 'closedByUser')
  closedSessions: any[];
}
