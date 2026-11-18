import { useJsonLogs } from './logging';

describe('useJsonLogs', () => {
  it('defaults to JSON only in production', () => {
    expect(useJsonLogs({ NODE_ENV: 'production' })).toBe(true);
    expect(useJsonLogs({ NODE_ENV: 'development' })).toBe(false);
  });

  it('honors LOG_FORMAT overrides', () => {
    expect(useJsonLogs({ NODE_ENV: 'production', LOG_FORMAT: 'pretty' })).toBe(false);
    expect(useJsonLogs({ NODE_ENV: 'development', LOG_FORMAT: 'json' })).toBe(true);
  });
});
