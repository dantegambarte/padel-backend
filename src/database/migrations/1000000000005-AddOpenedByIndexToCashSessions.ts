import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Añade índices de performance a `cash_sessions` para soportar:
 *  - El nuevo endpoint `GET /cash/daily-summary?date=YYYY-MM-DD` (filtro por fecha).
 *  - Queries de turno activo por usuario (filtro por opened_by_user_id).
 *
 * La columna `opened_by_user_id` ya existe desde la creación del esquema inicial.
 * El servicio garantiza que siempre se popula al abrir una sesión.
 * Esta migración documenta ese contrato y añade los índices correspondientes.
 */
export class AddOpenedByIndexToCashSessions1000000000005 implements MigrationInterface {
  name = 'AddOpenedByIndexToCashSessions1000000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cash_sessions_date"
        ON "cash_sessions" ("date");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cash_sessions_opened_by_user_id"
        ON "cash_sessions" ("opened_by_user_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cash_sessions_status"
        ON "cash_sessions" ("status")
        WHERE status = 'open';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cash_sessions_status";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cash_sessions_opened_by_user_id";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cash_sessions_date";`);
  }
}
