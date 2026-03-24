import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la columna `teacher_price` a la tabla `courts`.
 * Representa el precio especial de una hora de cancha cuando hay un profesor.
 * El valor por defecto es 0 para no afectar canchas ya existentes.
 */
export class AddTeacherPriceToCourts1000000000006 implements MigrationInterface {
  name = 'AddTeacherPriceToCourts1000000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "courts"
        ADD COLUMN IF NOT EXISTS "teacher_price" NUMERIC(10, 2) NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "courts" DROP COLUMN IF EXISTS "teacher_price";
    `);
  }
}
