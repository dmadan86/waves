/** Pure sums for the Loans screen: the summary card, the filter counts and repaid share. */

import type { LoanDirection } from '@waves/core';

export type LoanFilter = 'all' | 'owe' | 'owed';

export interface LoanLeft {
  readonly direction: LoanDirection;
  readonly left: bigint;
  readonly status?: 'active' | 'closed';
}

/** You owe = what is left on borrowed loans; you are owed = on lent ones; total = both. */
export function loanTotals(loans: readonly LoanLeft[]) {
  let owe = 0n;
  let owed = 0n;
  let oweCount = 0;
  let owedCount = 0;
  for (const l of loans) {
    if (l.status === 'closed') continue;
    if (l.direction === 'borrowed') {
      owe += l.left;
      oweCount += 1;
    } else {
      owed += l.left;
      owedCount += 1;
    }
  }
  return {
    owe,
    owed,
    total: owe + owed,
    counts: { all: oweCount + owedCount, owe: oweCount, owed: owedCount },
  };
}

export const matchesLoanFilter = (direction: LoanDirection, filter: LoanFilter): boolean =>
  filter === 'all' || (filter === 'owe') === (direction === 'borrowed');

/** What has been repaid (never negative, never above the principal) and its whole percent. */
export function repaid(principal: bigint, left: bigint): { amount: bigint; percent: number } {
  if (principal <= 0n) return { amount: 0n, percent: 0 };
  const amount = left >= principal ? 0n : left <= 0n ? principal : principal - left;
  return { amount, percent: Number((amount * 100n) / principal) };
}
