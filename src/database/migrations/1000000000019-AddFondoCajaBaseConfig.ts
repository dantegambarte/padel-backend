import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inserta la clave de configuración 'fondo_caja_base' en system_config
 * si todavía no existe. Valor por defecto: 25000.
 *
 * Esta clave es usada como fondo de caja inicial por defecto al abrir un turno.
 * No se contabiliza como ganancia; se incluye en el total físico del cajón al cierre.
 */
export class AddFondoCajaBaseConfig1000000000019 implements MigrationInterface {
  name = 'AddFondoCajaBaseConfig1000000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO system_config (key, value, description)
      VALUES (
        'fondo_caja_base',
        '25000',
        'Fondo de caja base (cambio inicial por defecto al abrir turno)'
      )
      ON CONFLICT (key) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM system_config WHERE key = 'fondo_caja_base'
    `);
  }
}
