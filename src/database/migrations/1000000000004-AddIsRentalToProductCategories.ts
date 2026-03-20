import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la columna `is_rental` (boolean, default false) a `product_categories`.
 *
 * Propósito: reemplazar la detección de categorías de alquiler basada en el nombre
 * (frágil, propenso a falsos positivos) por un flag explícito en la entidad.
 * Los productos cuya categoría tenga is_rental = true no descuentan stock en POS.
 *
 * Después de ejecutar esta migración, marcar manualmente la categoría "Alquileres":
 *   UPDATE product_categories SET is_rental = true WHERE LOWER(TRIM(name)) = 'alquileres';
 */
export class AddIsRentalToProductCategories1000000000004 implements MigrationInterface {
  name = 'AddIsRentalToProductCategories1000000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_categories"
      ADD COLUMN IF NOT EXISTS "is_rental" boolean NOT NULL DEFAULT false;
    `);

    // Marcar automáticamente la categoría canónica (coincidencia exacta)
    await queryRunner.query(`
      UPDATE "product_categories"
      SET "is_rental" = true
      WHERE LOWER(TRIM("name")) = 'alquileres';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_categories"
      DROP COLUMN IF EXISTS "is_rental";
    `);
  }
}
