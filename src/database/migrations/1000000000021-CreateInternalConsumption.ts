import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInternalConsumption1000000000021 implements MigrationInterface {
    name = 'CreateInternalConsumption1000000000021'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."internal_consumptions_consumer_type_enum" AS ENUM('staff', 'teacher')`);
        await queryRunner.query(`CREATE TYPE "public"."internal_consumptions_status_enum" AS ENUM('staff_consumption', 'pending_payment', 'paid')`);
        await queryRunner.query(`CREATE TABLE "internal_consumptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "quantity" integer NOT NULL DEFAULT '1', "consumer_type" "public"."internal_consumptions_consumer_type_enum" NOT NULL, "user_id" uuid, "teacher_id" uuid, "status" "public"."internal_consumptions_status_enum" NOT NULL, "notes" character varying(255), "unit_cost_price" numeric(10,2) NOT NULL DEFAULT '0', "date" date NOT NULL, "created_by_user_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4297be2f5a027bc1a6f26b45924" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "internal_consumptions" ADD CONSTRAINT "FK_c9a66007fc446f5f92ade7a91bc" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "internal_consumptions" ADD CONSTRAINT "FK_d8139db234ba078ee1d2939e82a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "internal_consumptions" ADD CONSTRAINT "FK_3da06135ee32edc09a5e001a8e0" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "internal_consumptions" ADD CONSTRAINT "FK_7c581776db9818b2c77c42a6a79" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "internal_consumptions" DROP CONSTRAINT "FK_7c581776db9818b2c77c42a6a79"`);
        await queryRunner.query(`ALTER TABLE "internal_consumptions" DROP CONSTRAINT "FK_3da06135ee32edc09a5e001a8e0"`);
        await queryRunner.query(`ALTER TABLE "internal_consumptions" DROP CONSTRAINT "FK_d8139db234ba078ee1d2939e82a"`);
        await queryRunner.query(`ALTER TABLE "internal_consumptions" DROP CONSTRAINT "FK_c9a66007fc446f5f92ade7a91bc"`);
        await queryRunner.query(`DROP TABLE "internal_consumptions"`);
        await queryRunner.query(`DROP TYPE "public"."internal_consumptions_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."internal_consumptions_consumer_type_enum"`);
    }

}
