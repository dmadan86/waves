/**
 * The dashboard's small sums, kept free of React so they can be tested alone:
 * the month before a month, a whole-percent change, and which recurring rules
 * are still coming up.
 */

import type { PersonalRecurring } from '@waves/core';

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

/** Active rules that have not run out, soonest first; ties break on the id. */
export function upcomingRules(recurrings: readonly PersonalRecurring[]): PersonalRecurring[] {
  return recurrings
    .filter((rule) => rule.active && (rule.endDate === null || rule.nextDate <= rule.endDate))
    .sort((a, b) =>
      a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : a.id < b.id ? -1 : 1,
    );
}

/** Whole days from `today` to `date`, both `YYYY-MM-DD`. */
export function daysBetween(today: string, date: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}
