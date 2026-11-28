/** The one quiet nudge on Today: the budget closest to (or past) its cap, from 90% on. */

import { personalBudgetProgress, type PersonalBudget, type PersonalTxn } from '@waves/core';

import { daysInMonth } from './weekPace';

export interface BudgetNudge {
  /** Null = the overall budget. */
  readonly category: string | null;
  readonly percent: number;
  /** Cap minus spent; negative when over. */
  readonly remaining: bigint;
  /** Whole days left in the month after today. */
  readonly daysLeft: number;
}

export function budgetNudge(
  budgets: readonly PersonalBudget[],
  txns: readonly PersonalTxn[],
  currency: string,
  today: string,
): BudgetNudge | null {
  const month = today.slice(0, 7);
  let best: { b: PersonalBudget; ratio: number; spent: bigint } | null = null;
  for (const b of budgets) {
    if (b.currency !== currency || b.limit <= 0n) continue;
    const p = personalBudgetProgress(b, txns, month);
    const ratio = Number(p.spent) / Number(b.limit);
    if (ratio >= 0.9 && (!best || ratio > best.ratio)) best = { b, ratio, spent: p.spent };
  }
  if (!best) return null;
  return {
    category: best.b.category,
    percent: Math.round(best.ratio * 100),
    remaining: best.b.limit - best.spent,
    daysLeft: daysInMonth(month) - Number(today.slice(8, 10)),
  };
}
