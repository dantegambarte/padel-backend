import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Check,
} from 'typeorm';
import { Booking } from './booking.entity';
import { Product } from '../../products/entities/product.entity';

/**
 * Productos consumidos durante un turno (bebidas, accesorios, etc.).
 * Al crear/actualizar items se descuenta stock en una transacción atómica.
 */
@Entity('booking_items')
@Check(`"quantity" > 0`)
export class BookingItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Booking, (booking) => booking.items, {
    nullable: false,
    onDelete: 'CASCADE', // si se borra la reserva, se borran sus items
  })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @ManyToOne(() => Product, (product) => product.bookingItems, {
    nullable: false,
    onDelete: 'RESTRICT',
    eager: true,
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'integer' })
  quantity: number;

  /**
   * Precio unitario al momento de la reserva (snapshot).
   */
  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 10,
    scale: 2,
  })
  unitPrice: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
