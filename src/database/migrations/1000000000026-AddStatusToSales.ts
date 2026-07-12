import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega `status` a `sales` para soportar "Cuentas Abiertas" (torneos/jornadas
 * largas): la venta se crea en 'open', descuenta stock al instante, y se
 * cobra/cierra después con status 'paid'. Ventas existentes quedan 'paid'
 * (ya fueron cobradas en el momento, comportamiento original).
 */
export class AddStatusToSales1000000000026 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "sales_status_enum" AS ENUM ('open', 'paid');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "sales"
      ADD COLUMN IF NOT EXISTS "status" "sales_status_enum" NOT NULL DEFAULT 'paid'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sales_status" ON "sales" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sales_status"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN IF EXISTS "status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "sales_status_enum"`);
  }
}
