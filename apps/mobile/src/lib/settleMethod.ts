export type SettleMethod = 'cash' | 'upi' | 'bank' | 'other';

export const SETTLE_METHODS: readonly SettleMethod[] = ['cash', 'upi', 'bank', 'other'];

/** UPI only when the money went through their UPI app; a payment merely noted here was most often cash. */
export function defaultSettleMethod(input: {
  handoff: boolean;
  payeeHasUpi: boolean;
}): SettleMethod {
  return input.handoff && input.payeeHasUpi ? 'upi' : 'cash';
}
