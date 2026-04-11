import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la columna `player_count` a `bookings` para persistir la cantidad
 * de jugadores en cancha seleccionada en el modal de cobro.
 * Valor null = no configurado (el frontend usa su default de 4).
 */
export class AddPlayerCountToBookings1000000000018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "player_count" integer NULL DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      DROP COLUMN IF EXISTS "player_count"
    `);
  }
}
