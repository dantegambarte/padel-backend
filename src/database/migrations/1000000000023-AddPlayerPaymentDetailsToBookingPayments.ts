import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlayerPaymentDetailsToBookingPayments1000000000023 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE booking_payments
      ADD COLUMN IF NOT EXISTS player_payment_details jsonb DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE booking_payments DROP COLUMN IF EXISTS player_payment_details
    `);
  }
}
