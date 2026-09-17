/**
 * Cutting a group's ledger into months, and naming them.
 *
 * Its own file because the order is a correctness rule with a test, not a
 * detail of the screen: the rows arrive ordered by when somebody typed the bill
 * in, and the feed has to read in the order the bills were *paid*.
 */

import type { Expense } from '@waves/api-client';

export interface MonthSection {
  key: string;
  /** A date inside the month, for the heading. Null for the undated bucket. */
  date: string | null;
  rows: Expense[];
}

/**
 * The ledger cut into calendar months, newest first.
 *
 * The rows arrive ordered by `created_at`, which is when somebody typed the
 * bill in — not when it was paid. Bucketing that order directly put a backdated
 * expense's whole month wherever it happened to be entered, so a July bill
 * added today opened the feed above September. The sort is on `expense_date`,
 * which is the date every row in this feed prints.
 *
 * An undated row keeps the sortless bucket it always had, at the end: there is
 * no date to place it by, and guessing one would be worse than admitting it.
 */
export function groupByMonth(items: readonly Expense[]): MonthSection[] {
  const dated = [...items].sort((a, b) => {
    const left = a.currentVersion?.expense_date ?? '';
    const right = b.currentVersion?.expense_date ?? '';
    // Plain ISO calendar dates, so a string compare is a date compare. The
    // empty string sorts last under a descending compare, which is where the
    // undated rows belong.
    if (left === right) return 0;
    return left < right ? 1 : -1;
  });

  const order: string[] = [];
  const buckets = new Map<string, Expense[]>();
  for (const item of dated) {
    const date = item.currentVersion?.expense_date ?? null;
    const key = date ? date.slice(0, 7) : '~';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(item);
  }
  return order.map((key) => {
    const rows = buckets.get(key)!;
    return { key, date: rows[0]?.currentVersion?.expense_date ?? null, rows };
  });
}

/**
 * "November", or "November 2024" once the year is not this one. The date is a
 * plain calendar date with no zone, so it is read in UTC to match the day the
 * rows beside it print.
 */
export function monthLabel(
  formats: { sameYear: Intl.DateTimeFormat; withYear: Intl.DateTimeFormat },
  isoDate: string,
): string {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return isoDate;
  const date = new Date(parsed);
  const thisYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return (thisYear ? formats.sameYear : formats.withYear).format(date);
}
