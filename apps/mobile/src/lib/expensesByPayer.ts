import type { ExpenseVersionRow } from '@/data/types';
import { convertedTotal } from '@/lib/expenseConversion';

export interface PayerSection<T> {
  /** The payer; null for a bill with no payer recorded. */
  readonly memberId: string | null;
  /** What they paid across these bills, in the group's currency. */
  readonly total: bigint;
  readonly rows: readonly T[];
}

/**
 * Group bills by who paid, biggest payer first. A bill with several payers sits
 * under each, and each heading counts only that payer's own share. A foreign
 * bill with no stored rate lists but adds nothing, as the balance does not count it.
 */
export function groupExpensesByPayer<T extends { currentVersion: ExpenseVersionRow | null }>(
  items: readonly T[],
  groupCurrency: string,
): PayerSection<T>[] {
  const map = new Map<string | null, { total: bigint; rows: T[] }>();
  for (const item of items) {
    const v = item.currentVersion;
    const payers = v && v.payers.length > 0 ? v.payers : [{ member_id: null, amount: '0' }];
    for (const p of payers) {
      const key = p.member_id;
      const s = map.get(key) ?? { total: 0n, rows: [] };
      map.set(key, s);
      s.rows.push(item);
      if (!v) continue;
      if (v.currency === groupCurrency) s.total += BigInt(p.amount);
      else s.total += convertedTotal({ ...v, amount: p.amount }, groupCurrency)?.minor ?? 0n;
    }
  }
  return [...map]
    .map(([memberId, s]) => ({ memberId, ...s }))
    .sort((a, b) => (a.total === b.total ? 0 : a.total < b.total ? 1 : -1));
}
