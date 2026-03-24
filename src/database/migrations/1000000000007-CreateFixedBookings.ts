import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea la tabla `fixed_bookings` para turnos fijos semanales
 * y agrega la columna `fixed_booking_id` (FK nullable) a `bookings`.
 */
export class CreateFixedBookings1000000000007 implements MigrationInterface {
  name = 'CreateFixedBookings1000000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fixed_bookings" (
        "id"               UUID              NOT NULL DEFAULT gen_random_uuid(),
        "client_name"      VARCHAR(150)      NOT NULL,
        "phone_number"     VARCHAR(30),
        "day_of_week"      INTEGER           NOT NULL,
        "hour"             VARCHAR(5)        NOT NULL,
        "duration_minutes" INTEGER           NOT NULL DEFAULT 60,
        "court_id"         UUID              NOT NULL,
        "monthly_deposit"  NUMERIC(10, 2)    NOT NULL DEFAULT 0,
        "is_active"        BOOLEAN           NOT NULL DEFAULT true,
        "start_date"       DATE              NOT NULL,
        "notes"            TEXT,
        "created_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fixed_bookings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fixed_bookings_court"
          FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE RESTRICT
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fixed_booking_court_day_hour"
        ON "fixed_bookings" ("court_id", "day_of_week", "hour");
    `);

    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD COLUMN IF NOT EXISTS "fixed_booking_id" UUID;
    `);

    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD CONSTRAINT "FK_bookings_fixed_booking"
          FOREIGN KEY ("fixed_booking_id") REFERENCES "fixed_bookings"("id") ON DELETE SET NULL
        NOT VALID;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bookings_fixed_booking_id"
        ON "bookings" ("fixed_booking_id")
        WHERE "fixed_booking_id" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bookings_fixed_booking_id";`);
    await queryRunner.query(`
      ALTER TABLE "bookings"
        DROP CONSTRAINT IF EXISTS "FK_bookings_fixed_booking";
    `);
    await queryRunner.query(`
      ALTER TABLE "bookings"
        DROP COLUMN IF EXISTS "fixed_booking_id";
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fixed_booking_court_day_hour";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fixed_bookings";`);
  }
}
