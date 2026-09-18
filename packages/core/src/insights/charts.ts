/**
 * The two shapes the spending screen draws, decided once.
 *
 * `computeSpendingRows` answers at the finest grain — one row per member, per
 * currency, per category, per month. A chart needs it coarser than that, and
 * the coarsening is where the interesting mistakes live, so it happens here
 * rather than in each client's JSX.
 *
 * Both functions return values, not labels: a category key and its snapshot, a
 * month string and a total. Naming a category is a translation and formatting a
 * figure is a locale, and a shared package can see neither.
 */

import { resolveCategory, type CategoryMeta } from '../category/index';
import type { SpendingRow } from './spending';

/** One bar: a category and what it came to. */
export interface CategorySlice {
  /** Stable across renders and unique per resolved category. */
  readonly key: string;
  /** The raw value off the rows, for a client that wants to resolve it again. */
  readonly category: string;
  /** The custom tag's snapshot, when this is one. */
  readonly meta: CategoryMeta | null;
  readonly value: bigint;
}

/** One column: a month and what it came to. */
export interface MonthTotal {
  /** First day of the month, 'YYYY-MM-DD'. */
  readonly month: string;
  readonly value: bigint;
}

/**
 * Spending per category, largest first.
 *
 * Bucketed by what a category *resolves to*, never by the raw string on the
 * row. Those are not the same thing, and the difference was visible: any value
 * the catalog does not know — a legacy id, a tag whose row never arrived, an
 * empty string — resolves to the built-in "Other", so a ledger carrying seven
 * such values drew seven separate bars all labelled "Other", one of them the
 * largest thing on the screen. Resolving first folds them into the single
 * "Other" they always were.
 *
 * A custom tag's display travels on its rows, and the first *meta* wins rather
 * than the first row: a tag is only itself while its snapshot is present, so
 * taking a null from an early row would send the whole tag into "Other" on the
 * strength of one expense that happened to be saved without it.
 *
 * Ties break by key so the order is stable between renders rather than left to
 * whatever the map happened to hold.
 */
export function categoryTotals(rows: readonly SpendingRow[]): CategorySlice[] {
  const metaByCategory = new Map<string, CategoryMeta | null>();
  for (const row of rows) {
    if (row.category_meta && !metaByCategory.get(row.category)) {
      metaByCategory.set(row.category, row.category_meta);
    } else if (!metaByCategory.has(row.category)) {
      metaByCategory.set(row.category, null);
    }
  }

  const totals = new Map<string, { value: bigint; category: string; meta: CategoryMeta | null }>();
  for (const row of rows) {
    const meta = metaByCategory.get(row.category) ?? null;
    const resolved = resolveCategory(row.category, meta);
    const key = resolved.custom ? `custom:${resolved.key}` : (resolved.builtinId ?? 'other');
    const seen = totals.get(key);
    if (seen) seen.value += BigInt(row.share_amount);
    else totals.set(key, { value: BigInt(row.share_amount), category: row.category, meta });
  }

  return [...totals]
    .sort((a, b) =>
      b[1].value === a[1].value ? a[0].localeCompare(b[0]) : b[1].value > a[1].value ? 1 : -1,
    )
    .map(([key, { value, category, meta }]) => ({ key, category, meta, value }));
}

/**
 * Spending per month, oldest first, ending with the most recent.
 *
 * `limit` keeps the last N months, because a chart of four years of columns is
 * a chart of nothing. The months are sliced off the *end* — the recent ones are
 * the ones somebody is looking for.
 */
export function monthTotals(rows: readonly SpendingRow[], limit = 6): MonthTotal[] {
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    totals.set(row.month, (totals.get(row.month) ?? 0n) + BigInt(row.share_amount));
  }
  return [...totals]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([month, value]) => ({ month, value }));
}

/** Everything these rows came to, in one currency's minor units. */
export function spendingTotal(rows: readonly SpendingRow[]): bigint {
  return rows.reduce((sum, row) => sum + BigInt(row.share_amount), 0n);
}

/**
 * The currencies present, the group's own first.
 *
 * Nothing is converted (ADR-003), so each currency is its own chart. Putting
 * the group's default first stops a single foreign expense becoming the
 * headline above the ledger everybody actually reads.
 */
export function spendingCurrencies(rows: readonly SpendingRow[], groupCurrency: string): string[] {
  return [...new Set(rows.map((row) => row.currency))].sort((a, b) =>
    a === groupCurrency ? -1 : b === groupCurrency ? 1 : a.localeCompare(b),
  );
}
