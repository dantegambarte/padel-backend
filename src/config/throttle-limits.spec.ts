import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants';
import { isThrottleRelaxed, resolveThrottleLimits, THROTTLE_LIMITS } from './throttle-limits';
import { AuthController } from '../modules/auth/auth.controller';
import { SearchController } from '../modules/search/search.controller';

const PRODUCTION_LIMITS = { relaxed: false, global: 60, search: 30, login: 5 };

describe('throttle limits', () => {
  it('uses production limits when the relax flag is not set, whatever NODE_ENV is', () => {
    for (const NODE_ENV of ['development', 'test', 'production', undefined]) {
      expect(resolveThrottleLimits({ NODE_ENV })).toEqual(PRODUCTION_LIMITS);
    }
  });

  it('relaxes the limits only with E2E_RELAX_THROTTLE=1 and NODE_ENV test or development', () => {
    expect(resolveThrottleLimits({ NODE_ENV: 'test', E2E_RELAX_THROTTLE: '1' })).toEqual({
      relaxed: true,
      global: 10_000,
      search: 1000,
      login: 1000,
    });
    expect(isThrottleRelaxed({ NODE_ENV: 'development', E2E_RELAX_THROTTLE: '1' })).toBe(true);
  });

  it('ignores the relax flag in production, with NODE_ENV unset or unknown', () => {
    for (const NODE_ENV of ['production', undefined, '', 'staging']) {
      expect(resolveThrottleLimits({ NODE_ENV, E2E_RELAX_THROTTLE: '1' })).toEqual(
        PRODUCTION_LIMITS,
      );
    }
  });

  it('ignores relax flag values other than "1"', () => {
    for (const E2E_RELAX_THROTTLE of ['0', 'true', '']) {
      expect(isThrottleRelaxed({ NODE_ENV: 'test', E2E_RELAX_THROTTLE })).toBe(false);
    }
  });

  // Jest runs with NODE_ENV=test and without the flag: the decorators must
  // carry the production limits, which the old NODE_ENV check relaxed.
  describe('applied limits under jest (NODE_ENV=test, no flag)', () => {
    const limitOf = (handler: object) => Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler);

    it('resolves the production limits', () => {
      expect(process.env.NODE_ENV).toBe('test');
      expect(THROTTLE_LIMITS).toEqual(PRODUCTION_LIMITS);
    });

    it('limits POST /auth/login to 5 per minute', () => {
      expect(limitOf(AuthController.prototype.login)).toBe(5);
    });

    it('limits GET /search to 30 per minute', () => {
      expect(limitOf(SearchController.prototype.search)).toBe(30);
    });
  });
});
