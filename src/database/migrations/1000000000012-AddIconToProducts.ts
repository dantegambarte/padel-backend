import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la columna `icon` (varchar 60, default 'inventory_2') a la tabla `products`.
 * Almacena el nombre del icono de Material Symbols Rounded para identificación visual.
 */
export class AddIconToProducts1000000000012 implements MigrationInterface {
  name = 'AddIconToProducts1000000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN IF NOT EXISTS "icon" varchar(60) NOT NULL DEFAULT 'inventory_2'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products" DROP COLUMN IF EXISTS "icon"
    `);
  }
}
