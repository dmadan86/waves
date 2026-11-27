/** Pure one-line summaries for the Accounts hub: what you hold, in one glance per card. */

import {
  personalBudgetProgress,
  type CurrencyCode,
  type PersonalBudget,
  type PersonalTxn,
} from '@waves/core';

import { loanTotals } from '@/lib/loansSummary';
import { plural, fill, type PluralForms } from '@/i18n';

export interface CurrencyAmount {
  readonly currency: string;
  readonly amount: bigint;
}

export interface AccountSummary {
  /** Every record, whatever its currency. */
  readonly count: number;
  /** The figure the line quotes, in the default currency only. */
  readonly amount: bigint;
  /** The same figure in each other currency, never added into `amount`. */
  readonly others: readonly CurrencyAmount[];
}

/** Sum by currency: the default one apart, the rest sorted by code. */
function split(entries: readonly CurrencyAmount[], dc: string): Omit<AccountSummary, 'count'> {
  let amount = 0n;
  const rest = new Map<string, bigint>();
  for (const e of entries) {
    if (e.currency === dc) amount += e.amount;
    else rest.set(e.currency, (rest.get(e.currency) ?? 0n) + e.amount);
  }
  const others = [...rest.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { amount, others };
}

/** What is left of every budget this month (never below zero), per currency. */
export function budgetsSummary(
  budgets: readonly PersonalBudget[],
  txns: readonly PersonalTxn[],
  month: string,
  dc: CurrencyCode,
): AccountSummary {
  const entries = budgets.map((budget) => {
    const remaining = personalBudgetProgress(budget, txns, month).remaining;
    return { currency: budget.currency as string, amount: remaining > 0n ? remaining : 0n };
  });
  return { count: budgets.length, ...split(entries, dc) };
}

/** Open loans and what is left on them (owed and owing together), per currency. */
export function loansSummary(
  loans: readonly {
    direction: 'borrowed' | 'lent';
    left: bigint;
    status?: 'active' | 'closed';
    currency: string;
  }[],
  dc: string,
): AccountSummary {
  const open = loans.filter((l) => l.status !== 'closed');
  const byCurrency = new Map<string, typeof open>();
  for (const l of open) byCurrency.set(l.currency, [...(byCurrency.get(l.currency) ?? []), l]);
  const entries = [...byCurrency.entries()].map(([currency, rows]) => ({
    currency,
    amount: loanTotals(rows).total,
  }));
  return { count: open.length, ...split(entries, dc) };
}

export function investedSummary(items: readonly CurrencyAmount[], dc: string): AccountSummary {
  return { count: items.length, ...split(items, dc) };
}

export function rentalsSummary(items: readonly CurrencyAmount[], dc: string): AccountSummary {
  return { count: items.length, ...split(items, dc) };
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

/** "+ $1,200 · AED 3,000 · +1 more": the top two other currencies, null when there are none. */
export function otherCurrenciesLine(
  others: readonly CurrencyAmount[],
  fmt: (amount: bigint, currency: string) => string,
  more: (n: number) => string,
): string | null {
  if (others.length === 0) return null;
  const shown = others.slice(0, 2).map((o) => fmt(o.amount, o.currency));
  if (others.length > 2) shown.push(more(others.length - 2));
  return `+ ${shown.join(' · ')}`;
}
