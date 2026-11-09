import type { MoneyDate } from '@waves/core';

export type UpcomingFilter = 'all' | 'overdue' | 'upcoming';

export function upcomingCounts(items: readonly MoneyDate[]) {
  const overdue = items.filter((item) => item.overdue).length;
  return { all: items.length, overdue, upcoming: items.length - overdue };
}

/** Filter by pill, then by name/number; a blank query keeps everything. */
export function filterUpcoming(
  items: readonly MoneyDate[],
  filter: UpcomingFilter,
  query: string,
): readonly MoneyDate[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (filter === 'all' || item.overdue === (filter === 'overdue')) &&
      (!q || item.title.toLowerCase().includes(q)),
  );
}

/** Sum of overdue amounts; rows with no amount (wages) add nothing. */
export function overdueTotal(items: readonly MoneyDate[]): bigint {
  // shortcut: sums minor units across currencies, fine while a company has one; split per currency if that changes.
  return items.reduce((sum, item) => (item.overdue ? sum + (item.amountMinor ?? 0n) : sum), 0n);
}
