import { type PaymentMethod } from '@waves/core';

export const PAYMENT_METHOD_ORDER: readonly PaymentMethod[] = [
  'cash',
  'upi',
  'credit',
  'debit',
  'forex',
];

export function offeredPaymentMethods({
  upiSupported,
  current,
}: {
  readonly upiSupported: boolean;
  readonly current: PaymentMethod | null;
}): PaymentMethod[] {
  return PAYMENT_METHOD_ORDER.filter(
    (method) => method !== 'upi' || upiSupported || current === 'upi',
  );
}
