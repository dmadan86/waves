/** The payer withdrew a payment before the payee confirmed it. */
export class PaymentWithdrawnError extends Error {
  constructor(readonly payerName: string) {
    super('PAYMENT_WITHDRAWN');
    this.name = 'PaymentWithdrawnError';
  }
}

/**
 * Whether the payee can still confirm or dispute a payment, judged on the
 * freshest rows: only a pending ("initiated") one can; the server refuses the
 * rest. A row we have never seen is let through (the server decides).
 */
export function assertStillPending(
  rows: readonly { id: string; status: string; from_member_id: string }[],
  settlementId: string,
  payerName: (memberId: string) => string,
): void {
  const row = rows.find((candidate) => candidate.id === settlementId);
  if (row?.status === 'cancelled') throw new PaymentWithdrawnError(payerName(row.from_member_id));
}
