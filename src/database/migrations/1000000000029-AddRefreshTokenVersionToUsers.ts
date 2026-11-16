import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la columna `refresh_token_version` (integer, default 0) a la tabla `users`.
 *
 * Propósito: rotación de refresh tokens. Cada refresh incrementa este valor y
 * el refresh token nuevo lo lleva en su payload (`rv`). Un refresh token con un
 * `rv` viejo es un reuso (token robado o ya usado): se rechaza y se revoca la
 * sesión entera incrementando `session_version`.
 */
export class AddRefreshTokenVersionToUsers1000000000029 implements MigrationInterface {
  name = 'AddRefreshTokenVersionToUsers1000000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "refresh_token_version" integer NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "refresh_token_version";
    `);
  }
}
