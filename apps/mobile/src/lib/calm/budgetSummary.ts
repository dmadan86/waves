/** The calm Budgets summary: the verdict sentence and the most-over-first category order. */

export interface CategoryLine {
  readonly id: string;
  readonly spent: bigint;
  readonly limit: bigint;
}

/** Over by (spent - limit) when negative remaining; `left` otherwise. */
export const overBy = (c: CategoryLine): bigint => (c.spent > c.limit ? c.spent - c.limit : 0n);

/** Whole-number share of the cap used (not clamped). */
export const percentUsed = (c: CategoryLine): number =>
  c.limit > 0n ? Math.round((Number(c.spent) / Number(c.limit)) * 100) : 0;

/** Over-budget ones first, by how much over; then the rest, closest to their cap first. */
export function sortCategories<T extends CategoryLine>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const oa = overBy(a);
    const ob = overBy(b);
    if (oa !== ob) return oa > ob ? -1 : 1;
    const pa = percentUsed(a);
    const pb = percentUsed(b);
    return pb - pa || (a.id < b.id ? -1 : 1);
  });
}

/** The (up to) two categories most over their cap: what the summary sentence names. */
export const topOver = <T extends CategoryLine>(rows: readonly T[]): T[] =>
  sortCategories(rows)
    .filter((c) => overBy(c) > 0n)
    .slice(0, 2);

/** Days left in the browsed month after today; null for any month but the current one. */
export function daysLeftInMonth(month: string, today: string): number | null {
  if (month !== today.slice(0, 7)) return null;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return last.getUTCDate() - Number(today.slice(8, 10));
}
