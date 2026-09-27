/**
 * The dashboard's small sums, kept free of React so they can be tested alone:
 * the month before a month, a whole-percent change, and how long ago a group
 * last moved.
 */

/** The `YYYY-MM` before a `YYYY-MM`: "2026-01" → "2025-12". */
export function previousMonthPrefix(prefix: string): string {
  const year = Number(prefix.slice(0, 4));
  const month = Number(prefix.slice(5, 7));
  if (!year || !month) return prefix;
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** Whole-percent change from `before` to `now`; null when there is no before. */
export function percentChange(now: bigint, before: bigint): number | null {
  if (before <= 0n) return null;
  return Math.round((Number(now - before) / Number(before)) * 100);
}

/** How long ago `then` was, in the largest whole unit that fits, for
 *  `Intl.RelativeTimeFormat`. Under a minute is `null` — the caller says "just now". */
export function relativeUnit(
  then: number,
  now: number,
): { value: number; unit: 'minute' | 'hour' | 'day' | 'month' | 'year' } | null {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return { value: -minutes, unit: 'minute' };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: -hours, unit: 'hour' };
  const days = Math.floor(hours / 24);
  if (days < 30) return { value: -days, unit: 'day' };
  const months = Math.floor(days / 30);
  if (months < 12) return { value: -months, unit: 'month' };
  return { value: -Math.floor(days / 365), unit: 'year' };
}
