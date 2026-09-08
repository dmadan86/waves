import { describe, expect, it } from 'vitest';

import { offeredPaymentMethods } from '../src/lib/paymentMethods';

describe('offeredPaymentMethods', () => {
  it('hides UPI for a new user or traveller expense outside UPI regions', () => {
    expect(offeredPaymentMethods({ upiSupported: false, current: 'cash' })).toEqual([
      'cash',
      'credit',
      'debit',
      'forex',
    ]);
  });

  it('keeps a saved UPI method visible for a financer editing an old expense', () => {
    expect(offeredPaymentMethods({ upiSupported: false, current: 'upi' })).toEqual([
      'cash',
      'upi',
      'credit',
      'debit',
      'forex',
    ]);
  });

  it('offers UPI normally where the rider can pay over that rail', () => {
    expect(offeredPaymentMethods({ upiSupported: true, current: null })).toEqual([
      'cash',
      'upi',
      'credit',
      'debit',
      'forex',
    ]);
  });
});
