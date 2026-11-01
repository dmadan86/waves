import { describe, expect, it } from 'vitest';

import { decideBillPayment } from '../src/lib/billPayment';

describe('decideBillPayment', () => {
  it('records nothing when unpaid', () => expect(decideBillPayment('unpaid', 500n, 0n)).toBeNull());
  it('records the full total when paid', () =>
    expect(decideBillPayment('paid', 500n, 9n)).toBe(500n));
  it('records the partial amount', () => expect(decideBillPayment('part', 500n, 200n)).toBe(200n));
  it('rejects a zero partial amount', () =>
    expect(decideBillPayment('part', 500n, 0n)).toBe('amount'));
  it('rejects a partial amount above the total', () =>
    expect(decideBillPayment('part', 500n, 501n)).toBe('over'));
  it('rejects a paid bill with no total', () =>
    expect(decideBillPayment('paid', 0n, 0n)).toBe('amount'));
});
