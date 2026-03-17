import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la columna `idempotency_key` (UUID, nullable, UNIQUE) a la tabla `sales`.
 *
 * Propósito: permite que el backend detecte y rechace solicitudes de venta
 * duplicadas (doble-clic, retry por red lenta) sin volver a descontar stock
 * ni registrar el movimiento en caja por segunda vez.
 *
 * El frontend genera un UUID por intento y lo envía en el header
 * `X-Idempotency-Key`. El backend lo persiste aquí y, si recibe la misma
 * clave en una segunda petición, retorna la venta existente sin ejecutar
 * ninguna lógica de negocio.
 */
export class AddIdempotencyKeyToSales1000000000001 implements MigrationInterface {
  name = 'AddIdempotencyKeyToSales1000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sales"
      ADD COLUMN IF NOT EXISTS "idempotency_key" uuid NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sales_idempotency_key"
      ON "sales" ("idempotency_key")
      WHERE "idempotency_key" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_sales_idempotency_key";
    `);
    await queryRunner.query(`
      ALTER TABLE "sales"
      DROP COLUMN IF EXISTS "idempotency_key";
    `);
  }
}
