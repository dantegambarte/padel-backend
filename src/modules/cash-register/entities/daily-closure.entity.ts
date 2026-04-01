import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Registro de Cierre de Jornada (Cierre Z del día completo).
 * Se persiste UNA sola vez por fecha comercial cuando el administrador/cajero
 * confirma el "Cierre de Jornada". Actúa como bloqueo para evitar dobles cierres.
 */
@Entity('daily_closures')
export class DailyClosureRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Fecha comercial del cierre (YYYY-MM-DD). Única por jornada.
   * Es la misma cadena que se usa en `cash_sessions.date`.
   */
  @Column({ type: 'date', unique: true })
  date: string;

  /** Momento exacto en que se ejecutó el Cierre de Jornada. */
  @CreateDateColumn({ name: 'closed_at', type: 'timestamptz' })
  closedAt: Date;
}
