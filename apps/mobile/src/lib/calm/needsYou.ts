/** What Today's "Needs you" card groups, in the order a person should deal with it. */

import type { PersonalRecurring, PersonalTxn } from '@waves/core';

import type { UpcomingRow } from '@/lib/personalUpcoming';

export type NeedItem =
  | {
      kind: 'rent';
      key: string;
      rank: number;
      inDays: number;
      tenancyId: string;
      propertyId: string;
    }
  | { kind: 'bill'; key: string; rank: number; inDays: number; rule: PersonalRecurring; date: string }
  | { kind: 'uncategorized'; key: string; rank: number; inDays: number; txns: PersonalTxn[] };

/** 0 overdue, 1 uncategorised, 2 due today: the owner's order. */
const RANK = { overdue: 0, uncategorized: 1, today: 2 } as const;

/** Expenses of `month` with no category, newest first. */
export function uncategorizedTxns(
  txns: readonly PersonalTxn[],
  month: string,
  currency: string,
): PersonalTxn[] {
  return txns
    .filter(
      (t) =>
        t.kind === 'expense' &&
        !t.category &&
        t.loanId === null &&
        t.currency === currency &&
        t.date.slice(0, 7) === month,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Bills due today or overdue (manual rules only: auto-posting ones are the
 * catch-up's job), rent that is not in yet, and the uncategorised expenses.
 */
export function needsYou(input: {
  bills: readonly UpcomingRow[];
  recurrings: readonly PersonalRecurring[];
  rent: readonly { tenancyId: string; propertyId: string; inDays: number; key: string }[];
  uncategorized: readonly PersonalTxn[];
}): NeedItem[] {
  const out: NeedItem[] = [];
  for (const r of input.rent) {
    out.push({
      kind: 'rent',
      key: r.key,
      rank: r.inDays < 0 ? RANK.overdue : RANK.today,
      inDays: r.inDays,
      tenancyId: r.tenancyId,
      propertyId: r.propertyId,
    });
  }
  for (const b of input.bills) {
    if (b.income || b.inDays > 0 || !b.ruleId || !b.date) continue;
    const rule = input.recurrings.find((x) => x.id === b.ruleId);
    if (!rule || rule.autoPost) continue;
    out.push({
      kind: 'bill',
      key: b.key,
      rank: b.inDays < 0 ? RANK.overdue : RANK.today,
      inDays: b.inDays,
      rule,
      date: b.date,
    });
  }
  if (input.uncategorized.length > 0) {
    out.push({
      kind: 'uncategorized',
      key: 'uncategorized',
      rank: RANK.uncategorized,
      inDays: 0,
      txns: [...input.uncategorized],
    });
  }
  return out.sort((a, b) => a.rank - b.rank || a.inDays - b.inDays || (a.key < b.key ? -1 : 1));
}

/** The "N things" count: an uncategorised group counts once, however many expenses it holds. */
export const needsCount = (items: readonly NeedItem[]): number => items.length;

/** The first three show; the rest hide behind "Show N more". */
export function visibleNeeds<T>(items: readonly T[], expanded: boolean, max = 3): T[] {
  return expanded ? [...items] : items.slice(0, max);
}
