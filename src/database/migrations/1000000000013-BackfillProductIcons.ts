import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Asigna el icono correcto a todos los productos existentes
 * basándose en el nombre de su categoría (palabras clave).
 */
export class BackfillProductIcons1000000000013 implements MigrationInterface {
  name = 'BackfillProductIcons1000000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE products p
      SET icon = CASE
        WHEN LOWER(pc.name) ~ 'bebida|agua|gatorade|jugo|isot|refresco|energizante|soda'
          THEN 'water_bottle'
        WHEN LOWER(pc.name) ~ 'comida|sandwich|s[aá]ndwich|snack|lunch|alimento|food'
          THEN 'lunch_dining'
        WHEN LOWER(pc.name) ~ 'paleta|raqueta|alquiler|pelota|deporte|sport|equipo'
          THEN 'sports_tennis'
        WHEN LOWER(pc.name) ~ 'ropa|indumentaria|remera|camiseta|short|calzado|apparel'
          THEN 'apparel'
        ELSE 'inventory_2'
      END
      FROM product_categories pc
      WHERE p.category_id = pc.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE products SET icon = 'inventory_2'
    `);
  }
}
