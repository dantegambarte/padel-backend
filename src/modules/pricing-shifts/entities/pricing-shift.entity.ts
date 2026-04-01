import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Franja horaria de precios dinámica.
 * Define qué precio aplica para una cancha (y el extra del profesor) según
 * el día de la semana y el horario del turno.
 *
 * Ejemplo: "Turno Mañana L-V" → Lun-Vie 08:00-14:00, $3.500 cancha / $500 profesor.
 */
@Entity('pricing_shifts')
export class PricingShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre descriptivo visible en la UI (ej. 'Turno Mañana Lunes a Viernes'). */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Hora de inicio de la franja en formato 'HH:mm'. */
  @Column({ name: 'start_time', type: 'varchar', length: 5 })
  startTime: string;

  /** Hora de fin de la franja en formato 'HH:mm'. */
  @Column({ name: 'end_time', type: 'varchar', length: 5 })
  endTime: string;

  /**
   * Días de la semana en que aplica esta franja.
   * 0 = Domingo, 1 = Lunes, ..., 6 = Sábado (convención JS Date.getDay()).
   * Almacenado como JSON array para preservar el tipo numérico.
   */
  @Column({ name: 'days_of_week', type: 'simple-json' })
  daysOfWeek: number[];

  /** Precio de alquiler normal para turnos de 30 minutos. */
  @Column({ name: 'price_30min', type: 'numeric', precision: 10, scale: 2, default: 0 })
  price30min: number;

  /** Precio de alquiler normal para turnos de 60 minutos. */
  @Column({ name: 'price_60min', type: 'numeric', precision: 10, scale: 2 })
  price60min: number;

  /** Precio de alquiler normal para turnos de 90 minutos. */
  @Column({ name: 'price_90min', type: 'numeric', precision: 10, scale: 2, default: 0 })
  price90min: number;

  /** Precio de alquiler normal para turnos de 120 minutos. */
  @Column({ name: 'price_120min', type: 'numeric', precision: 10, scale: 2, default: 0 })
  price120min: number;

  /**
   * Precio por hora del profesor (se multiplica proporcionalmente según la duración).
   * Se aplica cuando priceType === 'professor'.
   */
  @Column({ name: 'teacher_price_per_hour', type: 'numeric', precision: 10, scale: 2, default: 0 })
  teacherPricePerHour: number;

  /** Solo las franjas activas se aplican al calcular precios. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
