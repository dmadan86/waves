import { validatePayment } from '@waves/core';

export type BillPayChoice = 'unpaid' | 'part' | 'paid';

/** What to record after saving a new bill: null = nothing, bigint = the payment, string = the error code to show (do not save). */
export function decideBillPayment(
  choice: BillPayChoice,
  totalMinor: bigint,
  partMinor: bigint,
): bigint | null | 'amount' | 'over' {
  if (choice === 'unpaid') return null;
  const amount = choice === 'paid' ? totalMinor : partMinor;
  return validatePayment(totalMinor, 0n, amount) ?? amount;
}
