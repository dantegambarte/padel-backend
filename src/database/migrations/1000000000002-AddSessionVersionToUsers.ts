import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la columna `session_version` (integer, default 1) a la tabla `users`.
 *
 * Propósito: cada login incrementa este valor y lo incluye en el JWT payload.
 * El JwtStrategy compara el valor del token con el de la DB; si no coinciden
 * significa que el usuario inició sesión desde otro dispositivo, y el request
 * actual se rechaza con SESSION_OVERRIDDEN.
 */
export class AddSessionVersionToUsers1000000000002 implements MigrationInterface {
  name = 'AddSessionVersionToUsers1000000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "session_version" integer NOT NULL DEFAULT 1;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "session_version";
    `);
  }
}
