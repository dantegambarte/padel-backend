/**
 * Rate limits, with an explicit opt-in relaxation for local e2e suites.
 *
 * The frontend Playwright suite runs many workers from one IP and logs in per
 * spec, which trips the production limits. It sets E2E_RELAX_THROTTLE=1 to
 * raise them. The flag only works when NODE_ENV is explicitly "test" or
 * "development": an unset or production NODE_ENV keeps the real limits, so a
 * stray variable on a deployed host cannot disable rate limiting.
 */

type Env = Record<string, string | undefined>;

const RELAXABLE_ENVS = ['test', 'development'];

export function isThrottleRelaxed(env: Env = process.env): boolean {
  return env['E2E_RELAX_THROTTLE'] === '1' && RELAXABLE_ENVS.includes(env['NODE_ENV'] ?? '');
}

export function resolveThrottleLimits(env: Env = process.env) {
  const relaxed = isThrottleRelaxed(env);
  return {
    relaxed,
    /** Requests per minute per IP across the API. */
    global: relaxed ? 10_000 : 60,
    /** Requests per minute per IP on GET /search. */
    search: relaxed ? 1000 : 30,
    /** Requests per minute per IP on POST /auth/login. */
    login: relaxed ? 1000 : 5,
    /** Requests per minute per IP on POST /auth/refresh (every page load calls it). */
    refresh: relaxed ? 1000 : 20,
  };
}

/** Limits resolved once at startup; decorators read them at import time. */
export const THROTTLE_LIMITS = resolveThrottleLimits();
