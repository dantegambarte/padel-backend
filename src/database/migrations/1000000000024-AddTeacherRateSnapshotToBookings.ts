import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega `teacher_rate_snapshot` a `bookings` para congelar la tarifa del
 * profesor al momento del turno. Evita que cambios futuros en PricingShift
 * alteren liquidaciones históricas.
 * Solo se popula cuando priceType = 'professor'.
 */
export class AddTeacherRateSnapshotToBookings1000000000024 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "teacher_rate_snapshot" numeric(10,2) NULL DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      DROP COLUMN IF EXISTS "teacher_rate_snapshot"
    `);
  }
}
