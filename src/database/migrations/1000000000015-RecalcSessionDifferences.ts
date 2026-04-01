import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige los valores de `difference` guardados en `cash_sessions` que quedaron
 * con valores absurdos (ej. +360.000) debido al bug previo donde `cash_expected`
 * podía ser negativo cuando los egresos superaban los ingresos en efectivo.
 *
 * Nueva fórmula:
 *   difference = cash_counted - GREATEST(0, initial_balance + cash_income - cash_expense_total)
 *
 * El `GREATEST(0, ...)` es el "tope cero" que impide un `cash_expected` negativo.
 *
 * El `down()` no puede restaurar los valores originales (estaban mal calculados),
 * así que simplemente los marca como NULL para indicar que necesitan revisión manual.
 */
export class RecalcSessionDifferences1000000000015 implements MigrationInterface {
  name = 'RecalcSessionDifferences1000000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE cash_sessions cs
      SET difference = cs.cash_counted - GREATEST(0,
          cs.initial_balance
          + COALESCE((
              SELECT SUM(t.amount_cash)
              FROM transactions t
              WHERE t.cash_session_id = cs.id
            ), 0)
          - COALESCE((
              SELECT SUM(e.amount)
              FROM expenses e
              WHERE e.cash_session_id = cs.id
                AND e.deleted_at IS NULL
            ), 0)
      )
      WHERE cs.status = 'closed'
        AND cs.cash_counted IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Los valores originales eran incorrectos (bug): no existe un rollback significativo.
    // Se marca como NULL para forzar revisión manual si alguna vez fuera necesario.
    await queryRunner.query(`
      UPDATE cash_sessions
      SET difference = NULL
      WHERE status = 'closed'
    `);
  }
}
