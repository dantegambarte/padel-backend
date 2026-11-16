import { addDaysToIsoDate, todayInAppTimeZone } from './date.util';

describe('date.util', () => {
  describe('todayInAppTimeZone', () => {
    it('returns the Argentina date at 22:00 ART, when UTC is already the next day', () => {
      // 2026-03-10 22:00 ART == 2026-03-11 01:00 UTC
      expect(todayInAppTimeZone(new Date('2026-03-11T01:00:00Z'))).toBe('2026-03-10');
    });

    it('returns the same date as UTC during the afternoon', () => {
      expect(todayInAppTimeZone(new Date('2026-03-10T18:00:00Z'))).toBe('2026-03-10');
    });

    it('uses the current clock by default', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-12-31T23:30:00-03:00'));
      try {
        expect(todayInAppTimeZone()).toBe('2026-12-31');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('addDaysToIsoDate', () => {
    it('adds days across month and year boundaries', () => {
      expect(addDaysToIsoDate('2026-12-28', 7)).toBe('2027-01-04');
    });

    it('subtracts days', () => {
      expect(addDaysToIsoDate('2026-03-01', -1)).toBe('2026-02-28');
    });
  });
});
