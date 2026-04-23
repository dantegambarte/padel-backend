import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega `is_settled` a `bookings` para marcar turnos de profesor
 * que ya fueron incluidos en una liquidación pagada, evitando que
 * aparezcan en futuros reportes de deuda.
 */
export class AddIsSettledToBookings1000000000025 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "is_settled" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      DROP COLUMN IF EXISTS "is_settled"
    `);
  }
}
