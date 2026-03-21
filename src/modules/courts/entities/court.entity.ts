import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

@Entity('courts')
export class Court {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'price_30', type: 'numeric', precision: 10, scale: 2, default: 0 })
  price30: number;

  @Column({ name: 'price_60', type: 'numeric', precision: 10, scale: 2, default: 0 })
  price60: number;

  @Column({ name: 'price_90', type: 'numeric', precision: 10, scale: 2, default: 0 })
  price90: number;

  @Column({ name: 'price_120', type: 'numeric', precision: 10, scale: 2, default: 0 })
  price120: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany('Booking', 'court')
  bookings: any[];
}
