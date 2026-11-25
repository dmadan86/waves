import type { PersonalTxn } from '@waves/core';

/** Narrow a ledger to one loan's payments, or drop every loan repayment (as budgets do). */
export function loanScope<T extends Pick<PersonalTxn, 'loanId'>>(
  txns: readonly T[],
  scope: { loanId: string | null; excludeLoans: boolean },
): readonly T[] {
  if (scope.loanId) return txns.filter((x) => x.loanId === scope.loanId);
  return scope.excludeLoans ? txns.filter((x) => !x.loanId) : txns;
}
