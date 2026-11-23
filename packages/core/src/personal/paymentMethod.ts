/** The neutral stored value for a bank-to-bank instant payment. `upi` is the old spelling. */
export const INSTANT_TRANSFER = 'instant_transfer';

/** Read an old stored `upi` as `instant_transfer`; anything else passes through. */
export function normalizePaymentMethod(method: string | null | undefined): string | null {
  if (!method) return null;
  return method === 'upi' ? INSTANT_TRANSFER : method;
}

const INSTANT_TRANSFER_NAMES: Readonly<Record<string, string>> = {
  IN: 'UPI',
  GB: 'Faster Payments',
  AU: 'PayID',
  US: 'Zelle',
  AE: 'Aani',
};

/** The local name for instant transfer in a region, or null (caller shows "Instant transfer"). */
export function instantTransferName(countryCode: string | null | undefined): string | null {
  return INSTANT_TRANSFER_NAMES[(countryCode ?? '').trim().toUpperCase()] ?? null;
}
