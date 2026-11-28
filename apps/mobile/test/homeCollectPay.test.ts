import { describe, expect, it } from 'vitest';

import { collectPay } from '../src/lib/homeCollectPay';

const row = (person_key: string, currency: string, net: string, is_demo = false) => ({
  person_key,
  currency,
  net,
  is_demo,
});

describe('collectPay', () => {
  it('counts people and sums per direction in the headline currency', () => {
    const r = collectPay(
      [row('a', 'INR', '1000'), row('b', 'INR', '500'), row('c', 'INR', '-300')],
      'INR',
    );
    expect(r.collect).toEqual({ amount: 1500n, people: 2 });
    expect(r.pay).toEqual({ amount: 300n, people: 1 });
    expect(r.others).toEqual([]);
  });

  it('keeps other currencies on their own, never summed in', () => {
    const r = collectPay(
      [row('a', 'INR', '100'), row('b', 'USD', '2464'), row('c', 'EUR', '-1000')],
      'INR',
    );
    expect(r.collect.amount).toBe(100n);
    expect(r.others).toEqual([
      { currency: 'EUR', owed: 0n, owing: 1000n },
      { currency: 'USD', owed: 2464n, owing: 0n },
    ]);
  });

  it('skips settled people and the demo friends', () => {
    const r = collectPay([row('a', 'INR', '0'), row('d', 'INR', '900', true)], 'INR');
    expect(r.collect).toEqual({ amount: 0n, people: 0 });
    expect(r.pay).toEqual({ amount: 0n, people: 0 });
  });
});
