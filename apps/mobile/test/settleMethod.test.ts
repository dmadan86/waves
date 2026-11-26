import { describe, expect, it } from 'vitest';

import { defaultSettleMethod } from '../src/lib/settleMethod';

describe('defaultSettleMethod', () => {
  it('is cash when the payment was only noted, even if the payee has a UPI ID', () => {
    expect(defaultSettleMethod({ handoff: false, payeeHasUpi: true })).toBe('cash');
    expect(defaultSettleMethod({ handoff: false, payeeHasUpi: false })).toBe('cash');
  });
  it('is UPI after a hand-off to the payee UPI ID', () => {
    expect(defaultSettleMethod({ handoff: true, payeeHasUpi: true })).toBe('upi');
  });
});
