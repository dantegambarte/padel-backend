import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const databaseConfig = (configService: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DB_HOST', 'localhost'),
  port: configService.get<number>('DB_PORT', 5432),
  username: configService.get<string>('DB_USERNAME', 'padel_user'),
  password: configService.get<string>('DB_PASSWORD', 'padel_secret'),
  database: configService.get<string>('DB_DATABASE', 'padelsys'),

  synchronize: false,

  logging: configService.get<string>('NODE_ENV') === 'development',

  entities: [__dirname + '/../modules/**/entities/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],

  migrationsRun: false,

  // Options passed to the `pg` pool. Each PM2 instance opens its own pool, so
  // DB_POOL_MAX × instances must stay below Postgres `max_connections`.
  extra: {
    max: configService.get<number>('DB_POOL_MAX', 10),
    connectionTimeoutMillis: configService.get<number>('DB_CONNECTION_TIMEOUT_MS', 5000),
    idleTimeoutMillis: configService.get<number>('DB_IDLE_TIMEOUT_MS', 30000),
    // Kept below Nginx proxy_read_timeout (60s) so a stuck query fails before the proxy gives up.
    statement_timeout: configService.get<number>('DB_STATEMENT_TIMEOUT_MS', 30000),
  },
});
