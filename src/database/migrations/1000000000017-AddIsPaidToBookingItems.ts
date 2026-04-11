import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la columna `is_paid` a `booking_items` para soportar pagos parciales
 * por item. Un item marcado como pagado nunca se fusiona con uno nuevo del
 * mismo producto, evitando corrupción de estado en el frontend al recargar.
 */
export class AddIsPaidToBookingItems1000000000017 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "booking_items"
      ADD COLUMN IF NOT EXISTS "is_paid" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "booking_items"
      DROP COLUMN IF EXISTS "is_paid"
    `);
  }
}
