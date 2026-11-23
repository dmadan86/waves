/** Month-key helpers (YYYY-MM) the Personal and household homes share. */
import { dateTimeFormat } from '@/lib/dateTimeFormat';

/** Shift a YYYY-MM by whole calendar months (first-of-month maths, so days never overflow). */
export function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}-01T00:00:00`);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Whole months from `from` to `to`; negative if `to` precedes `from`. */
export function monthsBetween(from: string, to: string): number {
  const [fy = 0, fm = 0] = from.split('-').map(Number);
  const [ty = 0, tm = 0] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function fmtMonth(month: string, locale: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    // UTC on both sides: a cached formatter keeps the zone it was built in.
    return dateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(
      new Date(`${month}-01T00:00:00Z`),
    );
  } catch {
    return month;
  }
}

/** "August 2026". */
export const monthLabel = (month: string, locale: string): string =>
  fmtMonth(month, locale, { month: 'long', year: 'numeric' });
/** "Aug". */
export const monthShort = (month: string, locale: string): string =>
  fmtMonth(month, locale, { month: 'short' });
/** "Aug 2026". */
export const monthShortYear = (month: string, locale: string): string =>
  fmtMonth(month, locale, { month: 'short', year: 'numeric' });
