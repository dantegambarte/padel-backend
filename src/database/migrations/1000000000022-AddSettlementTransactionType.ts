import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSettlementTransactionType1000000000022 implements MigrationInterface {
  name = 'AddSettlementTransactionType1000000000022';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."transactions_type_enum" ADD VALUE IF NOT EXISTS 'settlement'`,
    );
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Postgres does not support removing enum values without recreating the type.
    // To roll back: delete all rows with type='settlement' first, then recreate the enum.
  }
}
