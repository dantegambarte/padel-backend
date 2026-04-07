import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Elimina el campo has_deposit de fixed_bookings y bookings.
 * La lógica de "señas" fue reemplazada por recordatorios automáticos por WhatsApp.
 */
export class RemoveHasDeposit1000000000009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fixed_bookings" DROP COLUMN IF EXISTS "has_deposit"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "has_deposit"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fixed_bookings" ADD COLUMN "has_deposit" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN "has_deposit" boolean NOT NULL DEFAULT false`,
    );
  }
}
