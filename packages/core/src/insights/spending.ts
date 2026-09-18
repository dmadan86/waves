/**
 * Where the money went — computed from the ledger the client already holds.
 *
 * This is the local-first twin of the `waves_group_spending` RPC (M5, TDR §8):
 * the same per-member, per-currency, per-category, per-month share totals, but
 * derived from the expenses the group screen already holds instead of a network
 * round-trip (ADR-005). Insights is a read of rows the client has, so on the
 * phone it works with no connection like every other read, and in the browser
 * it costs no extra request.
 *
 * It matches the server function exactly so the two are interchangeable:
 *   * only the current version of a non-deleted expense counts;
 *   * a category is lower-cased and trimmed, and anything empty or absent lands
 *     in 'other';
 *   * the month is the first day of the expense's month, taken by slicing the
 *     'YYYY-MM-DD' string so no timezone can move it;
 *   * nothing is converted between currencies and nothing is re-divided — the
 *     shares are exactly what the ledger stored, odd paisa and all (ADR-003).
 *
 * Because the phone reads its overlaid rows, an expense still sitting in the
 * mutation queue counts too — which is more current than the server-only RPC,
 * and correct: it is money the group has spent.
 *
 * It lived in the phone's data layer until the browser grew the same screen.
 */

import type { CategoryMeta } from '../category/index';

/**
 * The half of an expense this reads: its current version's money, its date and
 * who is splitting it.
 *
 * Typed structurally rather than as either client's expense row, so the phone's
 * mirrored shape and the browser's PostgREST shape both satisfy it without
 * either having to convert first.
 */
export interface SpendingExpense {
  readonly id: string;
  readonly deleted_at?: string | null;
  readonly currentVersion: {
    readonly currency: string;
    readonly category: string | null;
    readonly category_meta?: CategoryMeta | null;
    /** 'YYYY-MM-DD'. */
    readonly expense_date: string;
    readonly shares: readonly { readonly member_id: string; readonly amount: string }[];
  } | null;
}

/**
 * One (member, currency, category, month) total — the finest grain the charts
 * need, and the exact shape the `waves_group_spending` RPC returns.
 */
export interface SpendingRow {
  member_id: string;
  currency: string;
  /** Always set — an expense with no category comes back as 'other'. */
  category: string;
  /** A custom tag's {label, icon, tint} snapshot when the category is a user
   *  tag (extends TDR §8), so insights can label and colour its bar. Absent from
   *  the server RPC's rows; only this local twin fills it. */
  category_meta?: CategoryMeta | null;
  /** First day of the month, 'YYYY-MM-DD'. */
  month: string;
  /** This member's share of that category, in minor units. */
  share_amount: string;
  expense_count: number;
}

/** Lower-case, trim, and fall back to 'other' — matches the SQL COALESCE. */
function normaliseCategory(category: string | null | undefined): string {
  const trimmed = (category ?? '').trim().toLowerCase();
  return trimmed === '' ? 'other' : trimmed;
}

/**
 * First day of the month as 'YYYY-MM-01', taken from the leading 'YYYY-MM' of
 * the date string. Deliberately not `new Date(...)`: parsing would apply the
 * phone's timezone and, east of UTC, file a 1st-of-month expense under the
 * previous month.
 */
function firstOfMonth(expenseDate: string): string {
  return `${expenseDate.slice(0, 7)}-01`;
}

interface Bucket {
  member_id: string;
  currency: string;
  category: string;
  /** A custom tag's snapshot, so insights labels the bar with the tag rather
   *  than folding it into "Other" (extends TDR §8). Null for a built-in. */
  categoryMeta: CategoryMeta | null;
  month: string;
  amount: bigint;
  expenseIds: Set<string>;
}

// U+001F (unit separator) cannot appear in a uuid, currency, category or date,
// so it is a safe delimiter for the composite bucket key.
const KEY_SEP = String.fromCharCode(0x1f); // U+001F unit separator

/**
 * Aggregate a group's expenses into spending rows, one per
 * (member, currency, category, month) — the finest grain the charts need, and
 * the exact shape `fetchGroupSpending` returns, so `insights` can swap the RPC
 * for this with no other change.
 */
export function computeSpendingRows(expenses: readonly SpendingExpense[]): SpendingRow[] {
  const buckets = new Map<string, Bucket>();

  for (const expense of expenses) {
    // A deleted expense is not spending (matches `e.deleted_at IS NULL`).
    if (expense.deleted_at) continue;
    const version = expense.currentVersion;
    if (!version) continue;

    const currency = version.currency;
    const category = normaliseCategory(version.category);
    const categoryMeta = version.category_meta ?? null;
    const month = firstOfMonth(version.expense_date);

    for (const share of version.shares) {
      const key = [share.member_id, currency, category, month].join(KEY_SEP);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          member_id: share.member_id,
          currency,
          category,
          categoryMeta,
          month,
          amount: 0n,
          expenseIds: new Set(),
        };
        buckets.set(key, bucket);
      } else if (!bucket.categoryMeta && categoryMeta) {
        // A custom tag is only itself while its snapshot is present. If the
        // first expense in this bucket was saved without one, take the first
        // snapshot that does turn up rather than letting the whole bucket fall
        // through to the built-in "Other" on the Spending screen.
        bucket.categoryMeta = categoryMeta;
      }
      bucket.amount += BigInt(share.amount);
      bucket.expenseIds.add(expense.id);
    }
  }

  return [...buckets.values()].map((bucket) => ({
    member_id: bucket.member_id,
    currency: bucket.currency,
    category: bucket.category,
    category_meta: bucket.categoryMeta,
    month: bucket.month,
    // BIGINT is a string across the wire; keep the same so callers `BigInt(...)`
    // it exactly as they do the RPC's rows.
    share_amount: bucket.amount.toString(),
    expense_count: bucket.expenseIds.size,
  }));
}
