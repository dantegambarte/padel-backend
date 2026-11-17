import { ConfigService } from '@nestjs/config';
import { databaseConfig } from './database.config';

function configWith(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  } as unknown as ConfigService;
}

describe('databaseConfig', () => {
  it('uses bounded pool and timeout defaults', () => {
    const config = databaseConfig(configWith({}));

    expect(config.extra).toEqual({
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
    });
  });

  it('reads pool and timeouts from the environment', () => {
    const config = databaseConfig(
      configWith({
        DB_POOL_MAX: 4,
        DB_CONNECTION_TIMEOUT_MS: 2000,
        DB_IDLE_TIMEOUT_MS: 10000,
        DB_STATEMENT_TIMEOUT_MS: 15000,
      }),
    );

    expect(config.extra).toEqual({
      max: 4,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 15000,
    });
  });
});
