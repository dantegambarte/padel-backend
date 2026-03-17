import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const databaseConfig = (configService: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DB_HOST', 'localhost'),
  port: configService.get<number>('DB_PORT', 5432),
  username: configService.get<string>('DB_USERNAME', 'padel_user'),
  password: configService.get<string>('DB_PASSWORD', 'padel_secret'),
  database: configService.get<string>('DB_DATABASE', 'padelsys'),

  // NUNCA synchronize: true en producción.
  // Usamos migraciones para tener control total del schema.
  synchronize: configService.get<string>('NODE_ENV') === 'development',

  logging: configService.get<string>('NODE_ENV') === 'development',

  entities: [__dirname + '/../modules/**/entities/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  migrationsRun: false, // Ejecutar migraciones manualmente con npm run migration:run
});
