import { describe, expect, it } from 'vitest';

import { departedOpenBalance } from '@/lib/departedExpenses';

describe('departedOpenBalance', () => {
  it('reads the settlement-aware balance, not the gross of the bills', () => {
    // Guest owes 200 on the bills but paid 130 back: the ledger says -70.
    const net = new Map([['INR', new Map([['guest', -70n]])]]);
    expect(departedOpenBalance(net, 'guest')).toEqual(new Map([['INR', 70n]]));
  });
  it('is empty once square, and negative when they are owed', () => {
    expect(departedOpenBalance(new Map([['INR', new Map([['guest', 0n]])]]), 'guest').size).toBe(0);
    expect(departedOpenBalance(new Map([['INR', new Map([['guest', 40n]])]]), 'guest')).toEqual(
      new Map([['INR', -40n]]),
    );
  });
});
