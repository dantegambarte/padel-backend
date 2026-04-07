import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reemplaza `monthly_deposit` (numeric) en `fixed_bookings` por `has_deposit` (boolean).
 * Agrega `has_deposit` en `bookings` para poder mostrarlo en la grilla sin JOINs extra.
 */
export class FixedBookingsHasDeposit1000000000008 implements MigrationInterface {
  name = 'FixedBookingsHasDeposit1000000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "fixed_bookings"
        DROP COLUMN IF EXISTS "monthly_deposit";
    `);
    await queryRunner.query(`
      ALTER TABLE "fixed_bookings"
        ADD COLUMN IF NOT EXISTS "has_deposit" BOOLEAN NOT NULL DEFAULT false;
    `);

    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD COLUMN IF NOT EXISTS "has_deposit" BOOLEAN NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
        DROP COLUMN IF EXISTS "has_deposit";
    `);
    await queryRunner.query(`
      ALTER TABLE "fixed_bookings"
        DROP COLUMN IF EXISTS "has_deposit";
    `);
    await queryRunner.query(`
      ALTER TABLE "fixed_bookings"
        ADD COLUMN IF NOT EXISTS "monthly_deposit" NUMERIC(10, 2) NOT NULL DEFAULT 0;
    `);
  }
}
