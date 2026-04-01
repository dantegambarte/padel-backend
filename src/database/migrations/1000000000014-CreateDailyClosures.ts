import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDailyClosures1000000000014 implements MigrationInterface {
  name = 'CreateDailyClosures1000000000014';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_closures" (
        "id"        UUID         NOT NULL DEFAULT uuid_generate_v4(),
        "date"      DATE         NOT NULL,
        "closed_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_daily_closures_id"   PRIMARY KEY ("id"),
        CONSTRAINT "UQ_daily_closures_date" UNIQUE ("date")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_closures"`);
  }
}
