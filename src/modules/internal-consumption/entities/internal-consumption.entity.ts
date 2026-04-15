import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { User } from '../../users/entities/user.entity';
import { Teacher } from '../../teachers/entities/teacher.entity';

export enum InternalConsumptionStatus {
  STAFF_CONSUMPTION = 'staff_consumption',
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
}

export enum InternalConsumptionConsumerType {
  STAFF = 'staff',
  TEACHER = 'teacher',
}

@Entity('internal_consumptions')
export class InternalConsumption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  @Column({
    name: 'consumer_type',
    type: 'enum',
    enum: InternalConsumptionConsumerType,
  })
  consumerType: InternalConsumptionConsumerType;

  /** Staff consumer (nullable when consumerType = teacher) */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** Teacher consumer (nullable when consumerType = staff) */
  @ManyToOne(() => Teacher, { nullable: true, onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'teacher_id' })
  teacher: Teacher | null;

  @Column({ name: 'teacher_id', type: 'uuid', nullable: true })
  teacherId: string | null;

  @Column({
    type: 'enum',
    enum: InternalConsumptionStatus,
  })
  status: InternalConsumptionStatus;

  /** Optional note for internal tracking */
  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;

  /** Snapshot of product cost price at time of consumption */
  @Column({
    name: 'unit_cost_price',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  unitCostPrice: number;

  /** Date of consumption (YYYY-MM-DD) */
  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
