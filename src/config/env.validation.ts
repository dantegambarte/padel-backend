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
  // ── Entorno ─────────────────────────────────────────
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  PORT: Joi.number().port().default(3000),

  // ── Base de datos (OBLIGATORIAS) ─────────────────────
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

  // ── JWT (OBLIGATORIAS en producción) ─────────────────
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

  // ── CORS ─────────────────────────────────────────────
  CORS_ORIGIN: Joi.string().uri().default('http://localhost:4200'),
});
