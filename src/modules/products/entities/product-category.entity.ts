import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn } from 'typeorm';
import { Product } from './product.entity';

@Entity('product_categories')
export class ProductCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  /**
   * Marca esta categoría como "servicio de alquiler" (ej. alquiler de paletas, pelotas).
   * Los productos de esta categoría no descuentan stock en ventas POS.
   * Permite renombrar la categoría libremente sin romper la lógica de negocio.
   */
  @Column({ name: 'is_rental', type: 'boolean', default: false })
  isRental: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Product, (product) => product.category)
  products: Product[];
}
