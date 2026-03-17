import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Almacén clave-valor para configuraciones globales del sistema.
 *
 * Claves predefinidas:
 *   precio_estandar    → precio hora cancha estándar (ej: "3000")
 *   precio_profesor    → precio hora cancha profesor (ej: "2500")
 *   hora_apertura      → "09:00"
 *   hora_cierre        → "23:00"
 *   nombre_club        → "PadelSys"
 */
@Entity('system_config')
export class SystemConfig {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'varchar', length: 500 })
  value: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
