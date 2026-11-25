/**
 * The dashboard's small sums, kept free of React so they can be tested alone:
 * the month before a month and a whole-percent change.
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

/**
 * How many groups sit on each side of the Home balance card, in the headline
 * currency. The demo group's sample debts are in no total, so it is never counted.
 */
export function headlineGroupCounts(
  groups: readonly { id: string; default_currency?: string | null }[],
  headlineCurrency: string,
  fallback: string,
  balanceFor: (id: string) => bigint,
  demoId: string,
): { owed: number; owing: number } {
  const inHeadline = groups.filter(
    (g) => g.id !== demoId && (g.default_currency ?? fallback) === headlineCurrency,
  );
  return {
    owed: inHeadline.filter((g) => balanceFor(g.id) > 0n).length,
    owing: inHeadline.filter((g) => balanceFor(g.id) < 0n).length,
  };
}
