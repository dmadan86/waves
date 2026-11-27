/** Pure one-line summaries for the Accounts hub: what you hold, in one glance per card. */

import {
  personalBudgetProgress,
  type CurrencyCode,
  type PersonalBudget,
  type PersonalTxn,
} from '@waves/core';

import { loanTotals, type LoanLeft } from '@/lib/loansSummary';
import { plural, fill, type PluralForms } from '@/i18n';

export interface AccountSummary {
  readonly count: number;
  /** The figure the line quotes: left, outstanding, invested or due (default currency only). */
  readonly amount: bigint;
}

/** Budgets that cap the default currency, and what is left of them this month (never below zero). */
export function budgetsSummary(
  budgets: readonly PersonalBudget[],
  txns: readonly PersonalTxn[],
  month: string,
  dc: CurrencyCode,
): AccountSummary {
  let left = 0n;
  for (const budget of budgets) {
    if (budget.currency !== dc) continue;
    const remaining = personalBudgetProgress(budget, txns, month).remaining;
    if (remaining > 0n) left += remaining;
  }
  return { count: budgets.length, amount: left };
}

/** Open loans and what is left on them, owed and owing together. */
export function loansSummary(loans: readonly LoanLeft[]): AccountSummary {
  const totals = loanTotals(loans);
  return { count: totals.counts.all, amount: totals.total };
}

export function investedSummary(count: number, invested: bigint): AccountSummary {
  return { count, amount: invested };
}

export function rentalsSummary(count: number, due: bigint): AccountSummary {
  return { count, amount: due };
}

/** One card's line: the live summary, or the invitation when there is nothing yet. */
export function accountLine(
  summary: AccountSummary,
  locale: string,
  strings: { live: PluralForms | string; none: string },
  fmt: (amount: bigint) => string,
  amountKey: string,
): string {
  if (summary.count === 0) return strings.none;
  const template =
    typeof strings.live === 'string' ? strings.live : plural(locale, summary.count, strings.live);
  return fill(template, { n: summary.count, [amountKey]: fmt(summary.amount) });
}
