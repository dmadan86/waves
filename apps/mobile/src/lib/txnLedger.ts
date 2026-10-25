import { format, money, type PersonalTxn } from '@waves/core';

export type TxnTab = 'all' | 'expense' | 'income' | 'transfer';

export interface TxnFilters {
  tab: TxnTab;
  needle: string;
  locale?: string;
  categoryMatch?: (category: PersonalTxn['category']) => boolean;
  categoryLabel?: (category: string) => string;
  month?: string | null;
  from?: string | null;
  to?: string | null;
}

/** Search the same displayed note, category label and formatted amount as the ledger. */
export function filterTxns(txns: readonly PersonalTxn[], filters: TxnFilters): PersonalTxn[] {
  const { tab, locale, categoryMatch, categoryLabel, month, from, to } = filters;
  const needle = filters.needle.trim().toLocaleLowerCase(locale);
  return txns.filter(
    (txn) =>
      (!categoryMatch || categoryMatch(txn.category)) &&
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
