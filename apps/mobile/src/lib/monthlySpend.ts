import { isInvestmentCategory, type PersonalTxn } from '@waves/core';

/** The entries counted by Home's monthly Spent total and its drill-down. */
export function monthlySpendEntries(
  txns: readonly PersonalTxn[],
  month: string,
  currency: string,
): PersonalTxn[] {
  return txns.filter(
    (txn) =>
      txn.kind === 'expense' &&
      txn.currency === currency &&
      txn.date.slice(0, 7) === month &&
      !isInvestmentCategory(txn.category) &&
      txn.loanId === null &&
      !(txn as PersonalTxn & { deletedAt?: string | null }).deletedAt,
  );
}
