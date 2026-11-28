import { format, money, monthlySummary, type PersonalTxn } from '@waves/core';

import { isCreditCard } from '@/lib/personalMonthBreakdown';

export type TxnTab = 'all' | 'expense' | 'income' | 'transfer';

/** Recent means posted today or earlier; ledger order is already newest first. */
export function recentTxns(txns: readonly PersonalTxn[], today: string, limit = 3): PersonalTxn[] {
  return txns.filter((txn) => txn.date <= today).slice(0, limit);
}

export interface TxnFilters {
  tab: TxnTab;
  needle: string;
  locale?: string;
  categoryMatch?: (category: PersonalTxn['category']) => boolean;
  categoryLabel?: (category: string) => string;
  /** Narrow to credit-card payments (the dashboard's credit-card row). */
  creditOnly?: boolean;
  /** Only this currency, for drill-ins that must match the dashboard's total. */
  currency?: string | null;
  month?: string | null;
  from?: string | null;
  to?: string | null;
}

/** Search the same displayed note, category label and formatted amount as the ledger. */
export function filterTxns(txns: readonly PersonalTxn[], filters: TxnFilters): PersonalTxn[] {
  const { tab, locale, categoryMatch, categoryLabel, creditOnly, currency, month, from, to } =
    filters;
  const needle = filters.needle.trim().toLocaleLowerCase(locale);
  return txns.filter(
    (txn) =>
      (!categoryMatch || categoryMatch(txn.category)) &&
      (!creditOnly || isCreditCard(txn)) &&
      (!currency || txn.currency === currency) &&
      (tab === 'all' || (tab === 'transfer' ? txn.loanId !== null : txn.kind === tab)) &&
      (!month || txn.date.slice(0, 7) === month) &&
      (!from || txn.date >= from) &&
      (!to || txn.date <= to) &&
      (!needle ||
        [
          txn.note ?? '',
          txn.category ? (categoryLabel?.(txn.category) ?? txn.category) : '',
          format(money(txn.amount, txn.currency), { locale }),
        ].some((text) => text.toLocaleLowerCase(locale).includes(needle))),
  );
}

/** Unlike currencies have no meaningful combined total. */
export function dayNet(rows: readonly PersonalTxn[]): { net: bigint; currency: string } {
  const currency = rows[0]?.currency ?? '';
  if (rows.some((row) => row.currency !== currency)) return { net: 0n, currency: '' };
  return {
    net: rows.reduce((sum, row) => sum + (row.kind === 'income' ? row.amount : -row.amount), 0n),
    currency,
  };
}

/** Preserve ledger order, including row order, while collecting each calendar day. */
export function groupByDay(txns: readonly PersonalTxn[]) {
  const days = new Map<string, PersonalTxn[]>();
  for (const txn of txns) {
    const rows = days.get(txn.date) ?? [];
    rows.push(txn);
    days.set(txn.date, rows);
  }
  return Array.from(days, ([day, rows]) => ({ day, count: rows.length, ...dayNet(rows), rows }));
}

/**
 * The summary card's figures: the month's income, expenses and net in ONE currency (the one
 * with the most entries; unlike currencies are never summed) plus how many other currencies
 * had entries. Filter-independent, and the same totals as Home (`monthlySummary`).
 */
export function monthSummary(txns: readonly PersonalTxn[], month: string) {
  const counts = new Map<string, number>();
  for (const txn of txns) {
    if (txn.date.slice(0, 7) === month)
      counts.set(txn.currency, (counts.get(txn.currency) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const main = ranked[0]?.[0];
  if (!main) return null;
  const { income, expense, net } = monthlySummary(txns, month, main);
  return { currency: main, income, expense, net, otherCurrencies: ranked.length - 1 };
}
