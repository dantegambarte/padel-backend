import { BadRequestException } from '@nestjs/common';
import { resolveListDateRange } from './date-range.util';

// 2026-03-01 01:00 UTC is still 2026-02-28 in Buenos Aires.
const NOW = new Date('2026-03-01T01:00:00Z');

describe('resolveListDateRange', () => {
  it('defaults to the current month in the club time zone', () => {
    expect(resolveListDateRange(undefined, undefined, NOW)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('keeps explicit bounds', () => {
    expect(resolveListDateRange('2025-06-01', '2025-06-30', NOW)).toEqual({
      from: '2025-06-01',
      to: '2025-06-30',
    });
  });

  it('fills only the missing bound', () => {
    expect(resolveListDateRange('2026-02-10', undefined, NOW)).toEqual({
      from: '2026-02-10',
      to: '2026-02-28',
    });
  });

  it('accepts a range of exactly 366 days', () => {
    expect(resolveListDateRange('2025-01-01', '2026-01-02', NOW).to).toBe('2026-01-02');
  });

  it('rejects a range wider than 366 days', () => {
    expect(() => resolveListDateRange('2025-01-01', '2026-01-03', NOW)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a malformed date', () => {
    expect(() => resolveListDateRange('01/02/2026', undefined, NOW)).toThrow(BadRequestException);
  });

  it('rejects from after to', () => {
    expect(() => resolveListDateRange('2026-02-10', '2026-02-01', NOW)).toThrow(
      BadRequestException,
    );
  });

  it('rejects an open-ended from far in the past', () => {
    expect(() => resolveListDateRange('2020-01-01', undefined, NOW)).toThrow(BadRequestException);
  });
});
