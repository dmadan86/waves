import { describe, expect, it } from 'vitest';

import { assertStillPending, PaymentWithdrawnError } from '../src/lib/paymentWithdrawn';

const rows = [
  { id: 's1', status: 'initiated', from_member_id: 'a' },
  { id: 's2', status: 'cancelled', from_member_id: 'a' },
];

describe('assertStillPending', () => {
  it('lets a pending or unknown payment through', () => {
    expect(() => assertStillPending(rows, 's1', () => 'Ravi')).not.toThrow();
    expect(() => assertStillPending(rows, 'nope', () => 'Ravi')).not.toThrow();
  });
  it('names the payer who withdrew it', () => {
    expect(() => assertStillPending(rows, 's2', () => 'Ravi')).toThrow(PaymentWithdrawnError);
    try {
      assertStillPending(rows, 's2', () => 'Ravi');
    } catch (caught) {
      expect((caught as PaymentWithdrawnError).payerName).toBe('Ravi');
    }
  });
});
