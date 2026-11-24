/**
 * What the Personal home's "This month's money" and "By category" cards read:
 * recurring bills, loan repayments, credit-card spend and the category split for
 * one month in one currency. Pure, so the arithmetic is testable.
 */

import {
  categoryBreakdown,
  loanOutstanding,
  monthRange,
  occurrences,
  type CategorySpend,
  type CurrencyCode,
  type PersonalLoan,
  type PersonalRecurring,
  type PersonalTxn,
} from '@waves/core';

export interface MonthBreakdown {
  recurring: { expected: bigint; due: bigint; count: number };
  loans: { repaid: bigint; outstanding: bigint };
  creditCard: { total: bigint; count: number };
  categories: {
    rows: CategorySpend[];
    uncategorizedCount: number;
    uncategorizedTotal: bigint;
  };
}

/** A txn paid by credit card; `card` is the older stored spelling. */
export const isCreditCard = (txn: Pick<PersonalTxn, 'paymentMethod'>): boolean =>
  txn.paymentMethod === 'credit' || txn.paymentMethod === 'card';

export function monthBreakdown(
  txns: readonly PersonalTxn[],
  recurrings: readonly PersonalRecurring[],
  loans: readonly PersonalLoan[],
  month: string,
  currency: CurrencyCode,
  today: string,
): MonthBreakdown {
  const recurring = { expected: 0n, due: 0n, count: 0 };
  const range = monthRange(month);
  if (range) {
    for (const rule of recurrings) {
      if (!rule.active || rule.txnKind !== 'expense' || rule.currency !== currency) continue;
      for (const o of occurrences(rule, txns, range, today)) {
        recurring.expected += o.expected;
        recurring.count += 1;
        if (o.status !== 'received') recurring.due += o.expected;
      }
    }
  }

  const borrowed = new Set(loans.filter((l) => l.direction === 'borrowed').map((l) => l.id));
  let repaid = 0n;
  let outstanding = 0n;
  const creditCard = { total: 0n, count: 0 };
  let uncategorizedCount = 0;
  let uncategorizedTotal = 0n;
  for (const txn of txns) {
    if (txn.kind !== 'expense' || txn.currency !== currency || txn.date.slice(0, 7) !== month) {
      continue;
    }
    if (txn.loanId && borrowed.has(txn.loanId)) repaid += txn.amount;
    if (isCreditCard(txn)) {
      creditCard.total += txn.amount;
      creditCard.count += 1;
    }
    if (!txn.category) {
      uncategorizedCount += 1;
      uncategorizedTotal += txn.amount;
    }
  }
  for (const loan of loans) {
    if (loan.direction === 'borrowed' && loan.status === 'active' && loan.currency === currency) {
      outstanding += loanOutstanding(loan, txns);
    }
  }

  return {
    recurring,
    loans: { repaid, outstanding },
    creditCard,
    categories: {
      rows: categoryBreakdown(txns, month, currency),
      uncategorizedCount,
      uncategorizedTotal,
    },
  };
}
