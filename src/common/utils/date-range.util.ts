import { BadRequestException } from '@nestjs/common';
import { addDaysToIsoDate, todayInAppTimeZone } from './date.util';

/** Widest date range a list endpoint accepts, in days. */
export const MAX_LIST_RANGE_DAYS = 366;

export interface IsoDateRange {
  from: string;
  to: string;
}

/**
 * Resolves the date range of a list query so it can never return every row.
 * A missing bound defaults to the current month in the club's time zone.
 * Throws 400 when `from` is after `to` or the range is wider than
 * {@link MAX_LIST_RANGE_DAYS}.
 */
export function resolveListDateRange(
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): IsoDateRange {
  const today = todayInAppTimeZone(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonthStart = addDaysToIsoDate(monthStart, 32).slice(0, 7) + '-01';
  const monthEnd = addDaysToIsoDate(nextMonthStart, -1);

  const range = { from: from ?? monthStart, to: to ?? monthEnd };

  if (range.from > range.to) {
    throw new BadRequestException('La fecha "desde" no puede ser posterior a "hasta".');
  }
  if (range.to > addDaysToIsoDate(range.from, MAX_LIST_RANGE_DAYS)) {
    throw new BadRequestException(
      `El rango de fechas no puede superar los ${MAX_LIST_RANGE_DAYS} días.`,
    );
  }
  return range;
}
