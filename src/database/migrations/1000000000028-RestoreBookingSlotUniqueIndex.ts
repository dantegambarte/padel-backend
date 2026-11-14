import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Restores the anti-overbooking index created by
 * 1000000000016-PartialUniqueBookingSlot.
 *
 * In production that migration is recorded as applied, but the index was
 * later dropped (most likely by a schema synchronize, because the index was
 * not declared on the entity). It is now also declared on Booking.
 *
 * Idempotent: IF NOT EXISTS makes it a no-op where the index already exists.
 * Fails without changing anything if duplicate active bookings exist.
 */
export class RestoreBookingSlotUniqueIndex1000000000028 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_booking_court_date_hour_active"
      ON "bookings" ("court_id", "date", "hour")
      WHERE status != 'cancelled'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drops only the index; no data is touched.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_booking_court_date_hour_active"`);
  }
}
