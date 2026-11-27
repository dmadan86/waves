import { describe, expect, it } from 'vitest';

import {
  checkPartialAmount,
  partPaymentOf,
  partPaymentText,
  PartialCheck,
  remainderAfter,
} from '../src/index';

describe('part payments', () => {
  it('accepts any positive amount up to what is owed', () => {
    expect(checkPartialAmount(200_000n, 500_000n)).toBe(PartialCheck.Ok);
    expect(checkPartialAmount(500_000n, 500_000n)).toBe(PartialCheck.Ok);
    expect(checkPartialAmount(1n, 500_000n)).toBe(PartialCheck.Ok);
  });
  it('refuses zero and more than owed', () => {
    expect(checkPartialAmount(0n, 500_000n)).toBe(PartialCheck.Empty);
    expect(checkPartialAmount(500_001n, 500_000n)).toBe(PartialCheck.Over);
  });
  it('knows what is left', () => {
    expect(remainderAfter(500_000n, 200_000n)).toBe(300_000n);
    expect(remainderAfter(500_000n, 500_000n)).toBe(0n);
  });
  it('reads a part payment off an activity payload', () => {
    expect(partPaymentOf({ amount: 200000, owed: '500000', currency: 'INR' })).toEqual({
      amount: 200000n,
      owed: 500000n,
      currency: 'INR',
    });
    expect(partPaymentOf({ amount: 500000, currency: 'INR' })).toBeNull();
    expect(partPaymentOf(null)).toBeNull();
  });
});

it('words a part payment for the activity feed', () => {
  expect(partPaymentText({ amount: 200000, owed: '500000', currency: 'INR' }, 'en')).toMatch(
    /2,000.* of .*5,000/,
  );
  expect(partPaymentText({ amount: 500000, currency: 'INR' }, 'en')).toBeNull();
});
