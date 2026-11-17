import { envValidationSchema } from './env.validation';

const REQUIRED = {
  DB_HOST: 'localhost',
  DB_USERNAME: 'u',
  DB_PASSWORD: 'p',
  DB_DATABASE: 'd',
  JWT_SECRET: 'x'.repeat(32),
  JWT_REFRESH_SECRET: 'y'.repeat(32),
};

describe('envValidationSchema — database pool', () => {
  it('applies pool and timeout defaults', () => {
    const { value, error } = envValidationSchema.validate(REQUIRED);

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      DB_POOL_MAX: 10,
      DB_CONNECTION_TIMEOUT_MS: 5000,
      DB_IDLE_TIMEOUT_MS: 30000,
      DB_STATEMENT_TIMEOUT_MS: 30000,
    });
  });

  it('rejects a pool size of zero', () => {
    const { error } = envValidationSchema.validate({ ...REQUIRED, DB_POOL_MAX: 0 });

    expect(error?.message).toContain('DB_POOL_MAX');
  });

  it('rejects a non-numeric statement timeout', () => {
    const { error } = envValidationSchema.validate({
      ...REQUIRED,
      DB_STATEMENT_TIMEOUT_MS: 'soon',
    });

    expect(error?.message).toContain('DB_STATEMENT_TIMEOUT_MS');
  });
});
