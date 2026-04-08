import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reemplaza el UNIQUE CONSTRAINT completo en (court_id, date, hour) por un
 * índice único PARCIAL que excluye las reservas canceladas.
 *
 * Problema: al cancelar un turno el registro queda en la tabla con
 * status='cancelled'. Si luego se intenta crear una nueva reserva para el
 * mismo slot, el INSERT viola el constraint completo y el backend lanza 409
 * aunque la validación de solapamiento ya ignoraba los turnos cancelados.
 *
 * Solución: índice parcial WHERE status != 'cancelled', que permite
 * múltiples filas canceladas para el mismo slot pero sigue garantizando
 * unicidad entre reservas activas.
 */
export class PartialUniqueBookingSlot1000000000016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar el constraint completo anterior
    await queryRunner.query(
      `ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "UQ_booking_court_date_hour"`,
    );

    // 2. Crear índice único parcial: solo aplica a turnos NO cancelados
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_booking_court_date_hour_active"
      ON "bookings" ("court_id", "date", "hour")
      WHERE status != 'cancelled'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revertir: eliminar el índice parcial y restaurar el constraint completo
    // Nota: esto puede fallar si existen filas canceladas con combinaciones duplicadas.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_booking_court_date_hour_active"`,
    );

    await queryRunner.query(
      `ALTER TABLE "bookings"
       ADD CONSTRAINT "UQ_booking_court_date_hour" UNIQUE ("court_id", "date", "hour")`,
    );
  }
}
