import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea la tabla `teachers` y agrega la columna `teacher_id` (FK nullable)
 * a `bookings` y `fixed_bookings` para vincular turnos con profesores.
 */
export class CreateTeachers1000000000011 implements MigrationInterface {
  name = 'CreateTeachers1000000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Tabla teachers ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "teachers" (
        "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
        "full_name"    VARCHAR(150) NOT NULL,
        "phone_number" VARCHAR(30),
        "email"        VARCHAR(150),
        "is_active"    BOOLEAN      NOT NULL DEFAULT true,
        "created_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_teachers" PRIMARY KEY ("id")
      );
    `);

    // ── FK en bookings ─────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD COLUMN IF NOT EXISTS "teacher_id" UUID;
    `);

    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD CONSTRAINT "FK_bookings_teacher"
          FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL
        NOT VALID;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bookings_teacher_id"
        ON "bookings" ("teacher_id")
        WHERE "teacher_id" IS NOT NULL;
    `);

    // ── FK en fixed_bookings ───────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "fixed_bookings"
        ADD COLUMN IF NOT EXISTS "teacher_id" UUID;
    `);

    await queryRunner.query(`
      ALTER TABLE "fixed_bookings"
        ADD CONSTRAINT "FK_fixed_bookings_teacher"
          FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL
        NOT VALID;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "fixed_bookings"
        DROP CONSTRAINT IF EXISTS "FK_fixed_bookings_teacher";
    `);
    await queryRunner.query(`
      ALTER TABLE "fixed_bookings"
        DROP COLUMN IF EXISTS "teacher_id";
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bookings_teacher_id";`);
    await queryRunner.query(`
      ALTER TABLE "bookings"
        DROP CONSTRAINT IF EXISTS "FK_bookings_teacher";
    `);
    await queryRunner.query(`
      ALTER TABLE "bookings"
        DROP COLUMN IF EXISTS "teacher_id";
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "teachers";`);
  }
}
