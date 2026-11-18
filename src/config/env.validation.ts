import * as Joi from 'joi';

/**
 * Validación de variables de entorno al arrancar la aplicación.
 *
 * Si alguna variable obligatoria falta o tiene un valor inválido,
 * NestJS lanza un error ANTES de que el servidor levante, impidiendo
 * un inicio silencioso en producción con config rota.
 *
 * Uso en AppModule:
 *   ConfigModule.forRoot({ validationSchema: envValidationSchema })
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  // Local e2e only; honored only when NODE_ENV is test or development (see config/throttle-limits.ts).
  E2E_RELAX_THROTTLE: Joi.string().valid('0', '1').optional(),

  // Logging: JSON by default in production; override with json|pretty.
  LOG_FORMAT: Joi.string().valid('json', 'pretty').allow('').optional(),
  // Optional alert sink for unhandled errors (e.g. a Slack/Discord webhook). Unset = disabled.
  ERROR_WEBHOOK_URL: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .allow('')
    .optional(),

  PORT: Joi.number().port().default(3000),

  DB_HOST: Joi.string().required().messages({
    'any.required': 'DB_HOST es obligatorio. Revise el archivo .env',
  }),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required().messages({
    'any.required': 'DB_USERNAME es obligatorio.',
  }),
  DB_PASSWORD: Joi.string().required().messages({
    'any.required': 'DB_PASSWORD es obligatorio.',
  }),
  DB_DATABASE: Joi.string().required().messages({
    'any.required': 'DB_DATABASE es obligatorio.',
  }),

  // Pool de conexiones de `pg` (por instancia de PM2) y timeouts, en milisegundos.
  DB_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),
  DB_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(100).default(5000),
  DB_IDLE_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  DB_STATEMENT_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),

  JWT_SECRET: Joi.string().min(32).required().messages({
    'any.required': 'JWT_SECRET es obligatorio (mínimo 32 caracteres).',
    'string.min': 'JWT_SECRET debe tener al menos 32 caracteres por seguridad.',
  }),
  JWT_EXPIRES_IN: Joi.string().default('8h'),

  JWT_REFRESH_SECRET: Joi.string().min(32).required().messages({
    'any.required': 'JWT_REFRESH_SECRET es obligatorio (mínimo 32 caracteres).',
    'string.min': 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres.',
  }),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  CORS_ORIGIN: Joi.string().uri().default('http://localhost:4200'),

  // Days an inactive fixed booking or teacher keeps its phone number before the
  // daily privacy cron nulls it (see modules/privacy).
  CUSTOMER_PHONE_RETENTION_DAYS: Joi.number().integer().min(1).max(3650).default(365),
});
