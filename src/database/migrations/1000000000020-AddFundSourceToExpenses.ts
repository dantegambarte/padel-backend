import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFundSourceToExpenses1000000000020 implements MigrationInterface {
  name = 'AddFundSourceToExpenses1000000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."expenses_fund_source_enum" AS ENUM('cash_register', 'general_funds')`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" ADD "fund_source" "public"."expenses_fund_source_enum" DEFAULT 'cash_register'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "expenses" DROP COLUMN "fund_source"`);
    await queryRunner.query(`DROP TYPE "public"."expenses_fund_source_enum"`);
  }
}
