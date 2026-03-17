/**
 * DataSource independiente, usado exclusivamente por la CLI de TypeORM
 * para generar y ejecutar migraciones.
 *
 * Uso:
 *   npm run migration:generate -- src/database/migrations/NombreMigracion
 *   npm run migration:run
 *   npm run migration:revert
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'padel_user',
  password: process.env.DB_PASSWORD || 'padel_secret',
  database: process.env.DB_DATABASE || 'padelsys',

  // En producción: synchronize SIEMPRE false. Usamos migraciones.
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',

  entities: [__dirname + '/../modules/**/entities/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTableName: 'typeorm_migrations',
});
