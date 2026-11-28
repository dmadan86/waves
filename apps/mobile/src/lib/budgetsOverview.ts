import {
  personalBudgetProgress,
  type CurrencyCode,
  type PersonalBudget,
  type PersonalTxn,
} from '@waves/core';

export interface BudgetsOverview {
  readonly spent: bigint;
  readonly limit: bigint;
  /** limit − spent; negative when over. */
  readonly remaining: bigint;
  readonly over: boolean;
  /** Whole-number share of the cap used (not clamped: 112 means 112%). */
  readonly percent: number;
  /** The explicit overall budget when one exists, so the card can open it. */
  readonly overall: PersonalBudget | null;
}

/**
 * The headline card: the overall cap if there is one, else every category cap
 * added up against what those categories spent. One currency only — caps in
 * different currencies do not add.
 */
export function budgetsOverview(
  budgets: readonly PersonalBudget[],
  txns: readonly PersonalTxn[],
  month: string,
  currency: CurrencyCode,
): BudgetsOverview | null {
  const mine = budgets.filter((b) => b.currency === currency);
  const overall = mine.find((b) => b.category === null) ?? null;
  const parts = overall ? [overall] : mine;
  if (parts.length === 0) return null;
  let spent = 0n;
  let limit = 0n;
  for (const b of parts) {
    spent += personalBudgetProgress(b, txns, month).spent;
    limit += b.limit;
  }
  return {
    spent,
    limit,
    remaining: limit - spent,
    over: spent > limit,
    percent: limit > 0n ? Math.round((Number(spent) / Number(limit)) * 100) : 0,
    overall,
  };
}
