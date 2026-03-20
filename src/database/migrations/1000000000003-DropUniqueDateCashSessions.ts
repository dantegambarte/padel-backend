import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Elimina el constraint UNIQUE en la columna `date` de `cash_sessions`.
 *
 * Motivo: el modelo de apertura explícita permite múltiples jornadas por día
 * (turno mañana / turno tarde). La unicidad real es "solo una sesión OPEN a la vez",
 * que se garantiza a nivel de aplicación en CashRegisterService.openSession().
 */
export class DropUniqueDateCashSessions1000000000003 implements MigrationInterface {
  name = 'DropUniqueDateCashSessions1000000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cash_sessions"
      DROP CONSTRAINT IF EXISTS "UQ_cash_session_date";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cash_sessions"
      ADD CONSTRAINT "UQ_cash_session_date" UNIQUE ("date");
    `);
  }
}
