/**
 * The expenses behind one column of the spending chart.
 *
 * The contract this file exists to keep: **what the drill adds up to is what
 * the column said.** Insights sums the shares the ledger stored; the drill
 * re-reads the same expenses and slices them to one month and one currency. If
 * the two ever disagree, somebody taps ₹48,200 and lands on a page that totals
 * ₹51,000, and neither number can be trusted again.
 *
 * They agree because the scope is applied the same way in both places, and that
 * is the subtle half:
 *
 * - **group scope** counts the whole expense, because the chart's group figure
 *   is the sum of everybody's shares, which is the whole expense;
 * - **mine scope** counts only this person's shares, and drops an expense they
 *   had no share in — not showing it as zero, because a bill you are not on is
 *   not a line in your spending.
 *
 * Kept out of the screen so the contract can be tested against `monthTotals`
 * rather than asserted by eye.
 */

/** The half of an expense the drill reads. */
export interface DrillExpense {
  readonly id: string;
  readonly deleted_at?: string | null;
  readonly currentVersion: {
    readonly currency: string;
    /** 'YYYY-MM-DD'. */
    readonly expense_date: string;
    readonly amount: string;
    readonly shares: readonly { readonly member_id: string; readonly amount: string }[];
  } | null;
}

export interface DrillRow<T> {
  readonly expense: T;
  /** What this row shows: the whole bill, or this person's share of it. */
  readonly amount: bigint;
  /** 'YYYY-MM-DD'. */
  readonly day: string;
}

/** Sum of one member's shares in a version, in minor units. */
export function myShare(
  shares: readonly { member_id: string; amount: string }[],
  memberId: string | null,
): bigint {
  if (!memberId) return 0n;
  return shares
    .filter((share) => share.member_id === memberId)
    .reduce((sum, share) => sum + BigInt(share.amount), 0n);
}

/**
 * The rows behind a column: live, in this currency, in this month, and — in
 * "mine" scope — only the ones this person had a share in.
 *
 * `month` is 'YYYY-MM'. The column passes the first of the month, so a caller
 * slices it; comparing the date's own leading seven characters means no
 * timezone can move an expense into the month before.
 */
export function monthRows<T extends DrillExpense>(
  expenses: readonly T[],
  options: { month: string; currency: string; mine: boolean; myMemberId: string | null },
): DrillRow<T>[] {
  const out: DrillRow<T>[] = [];
  for (const expense of expenses) {
    if (expense.deleted_at) continue;
    const version = expense.currentVersion;
    if (!version || version.currency !== options.currency) continue;
    if (version.expense_date.slice(0, 7) !== options.month) continue;
    const amount = options.mine
      ? myShare(version.shares, options.myMemberId)
      : BigInt(version.amount);
    // A bill you are not on is not a line in your own spending — and the chart
    // did not count it either, so showing it here as zero would put a row on
    // screen that the column never included.
    if (options.mine && amount === 0n) continue;
    out.push({ expense, amount, day: version.expense_date.slice(0, 10) });
  }
  return out;
}

/**
 * The rows by day, newest day first and newest within a day — a ledger reads
 * most-recent-down, the same as the group page.
 */
export function byDay<T>(
  rows: readonly DrillRow<T>[],
): [string, { total: bigint; items: DrillRow<T>[] }][] {
  const days = new Map<string, { total: bigint; items: DrillRow<T>[] }>();
  for (const row of rows) {
    const bucket = days.get(row.day) ?? { total: 0n, items: [] };
    bucket.total += row.amount;
    bucket.items.push(row);
    days.set(row.day, bucket);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/** What the whole drill comes to — which is what the column said. */
export function drillTotal<T>(rows: readonly DrillRow<T>[]): bigint {
  return rows.reduce((sum, row) => sum + row.amount, 0n);
}

/**
 * Whether a currency code is one this page can format.
 *
 * A month URL can be typed, shared or truncated, and `Intl.NumberFormat` throws
 * a `RangeError` on a code it does not recognise — which would take the whole
 * route down rather than showing an empty month. Three ASCII letters is the
 * shape of every ISO 4217 code; anything else is not a link this screen can
 * honour.
 */
export function isCurrencyCode(value: string): boolean {
  return /^[A-Za-z]{3}$/.test(value);
}
