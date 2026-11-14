import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the deposit amount columns used by Booking and FixedBooking entities.
 *
 * In production these columns were created manually, outside TypeORM, so this
 * migration is idempotent (IF NOT EXISTS) and is a no-op there. On a fresh
 * database it creates them. It intentionally does not touch the booking slot
 * uniqueness: that is owned by 1000000000016-PartialUniqueBookingSlot.
 */
export class AddDepositAmounts1000000000027 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "expected_deposit_amount" numeric(10,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "fixed_bookings"
      ADD COLUMN IF NOT EXISTS "recurring_deposit_amount" numeric(10,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fixed_bookings" DROP COLUMN IF EXISTS "recurring_deposit_amount"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "expected_deposit_amount"`);
  }
}
