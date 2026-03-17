import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
} from 'typeorm';
import { ProductCategory } from './product-category.entity';

@Entity('products')
@Check(`"stock" >= 0`)
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @ManyToOne(() => ProductCategory, (category) => category.products, {
    nullable: true,
    onDelete: 'SET NULL',
    eager: true, // siempre cargamos la categoría junto al producto
  })
  @JoinColumn({ name: 'category_id' })
  category: ProductCategory;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string;

  @Column({
    name: 'cost_price',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  costPrice: number;

  @Column({
    name: 'sale_price',
    type: 'numeric',
    precision: 10,
    scale: 2,
  })
  salePrice: number;

  @Column({ type: 'integer', default: 0 })
  stock: number;

  /**
   * Umbral mínimo de stock. Si stock < minStock, el Dashboard Empleado
   * mostrará una alerta de reabastecimiento.
   */
  @Column({ name: 'min_stock', type: 'integer', default: 5 })
  minStock: number;

  /**
   * Los productos marcados como destacados aparecen como botones
   * de acceso rápido en el modal de Agenda (Fase 3 / 7).
   */
  @Column({ name: 'is_featured', type: 'boolean', default: false })
  isFeatured: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ── Relaciones inversas ──────────────────────────────
  @OneToMany('BookingItem', 'product')
  bookingItems: any[];

  @OneToMany('SaleItem', 'product')
  saleItems: any[];
}
