/** Time zone of the club. Business dates ("today") are always computed here. */
export const APP_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/**
 * Today's date in the club's time zone, as YYYY-MM-DD.
 * Never use `toISOString()` for this: it returns the UTC date, which is
 * already tomorrow from 21:00 Argentina time.
 */
export function todayInAppTimeZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(now);
}

/** Adds (or subtracts) whole days to a YYYY-MM-DD date, independent of the server time zone. */
export function addDaysToIsoDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Day of the week of a YYYY-MM-DD date, in JS format (0=Sunday … 6=Saturday). */
export function dayOfWeekOfIsoDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
