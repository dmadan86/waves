import { describe, expect, it } from 'vitest';

import { pendingPairKey, splitSettlePlan, type PlanTransfer } from '../src/lib/settlePlan';

const t = (from: string, to: string, amount: bigint, currency = 'INR'): PlanTransfer => ({
  from,
  to,
  amount,
  currency,
});

describe('splitSettlePlan', () => {
  it('cuts the plan into owes-me, i-owe and others, keeping order', () => {
    const plan = [t('a', 'me', 100n), t('me', 'b', 50n), t('a', 'b', 20n), t('c', 'me', 5n)];
    const split = splitSettlePlan(plan, 'me');
    expect(split.owesMe).toEqual([plan[0], plan[3]]);
    expect(split.iOwe).toEqual([plan[1]]);
    expect(split.others).toEqual([plan[2]]);
  });

  it('treats everything as others when I am unknown', () => {
    const plan = [t('a', 'b', 1n)];
    expect(splitSettlePlan(plan, null).others).toEqual(plan);
  });

  it('drops zero-amount transfers', () => {
    const split = splitSettlePlan([t('a', 'me', 0n)], 'me');
    expect(split.owesMe).toEqual([]);
  });
});

describe('pendingPairKey', () => {
  const family: Record<string, string> = { a1: 'A', a2: 'A', b: 'B' };
  const partyOf = (id: string): string => family[id] ?? id;

  it('matches a payment another member of the family already marked', () => {
    const marked = pendingPairKey('a1', 'b', 'INR', partyOf);
    expect(pendingPairKey('a2', 'b', 'INR', partyOf)).toBe(marked);
    expect(pendingPairKey('a2', 'b', 'USD', partyOf)).not.toBe(marked);
    expect(pendingPairKey('b', 'a2', 'INR', partyOf)).not.toBe(marked);
  });

  it('is the exact pair in the person lens', () => {
    expect(pendingPairKey('a2', 'b', 'INR')).not.toBe(pendingPairKey('a1', 'b', 'INR'));
    expect(pendingPairKey('a1', 'b', 'INR')).toBe('a1>b>INR');
  });
});
