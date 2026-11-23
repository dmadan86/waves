import { instantTransferName, normalizePaymentMethod } from '@waves/core';

/**
 * A stored payment method in words. `upi` and `instant_transfer` are the same
 * thing: the local rail's name where the region has one, else "Instant transfer".
 * A method this version does not know reads as `methods.other`.
 */
export function paymentMethodLabel(
  methods: Readonly<Record<string, string>>,
  id: string,
  country: string | null,
): string {
  const method = normalizePaymentMethod(id) ?? 'other';
  if (method === 'instant_transfer') {
    return instantTransferName(country) ?? methods.instant_transfer ?? 'Instant transfer';
  }
  return methods[method] ?? methods.other ?? 'Other';
}
