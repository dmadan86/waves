import { describe, expect, it } from 'vitest';

import {
  settleHero,
  splitSettlePlan,
  summariseSettlePlan,
  type PlanTransfer,
} from '../src/lib/settlePlan';

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

describe('summariseSettlePlan', () => {
  it('is settled with no rows of mine', () => {
    const split = splitSettlePlan([t('a', 'b', 10n)], 'me');
    expect(summariseSettlePlan(split, 'INR').kind).toBe('settled');
  });

  it('reports owed, owe and both', () => {
    expect(summariseSettlePlan(splitSettlePlan([t('a', 'me', 120n)], 'me'), 'INR')).toMatchObject({
      kind: 'owed',
      owed: 120n,
      net: 120n,
    });
    expect(summariseSettlePlan(splitSettlePlan([t('me', 'a', 45n)], 'me'), 'INR')).toMatchObject({
      kind: 'owe',
      owe: 45n,
      net: -45n,
    });
    expect(
      summariseSettlePlan(splitSettlePlan([t('a', 'me', 100n), t('me', 'b', 30n)], 'me'), 'INR'),
    ).toMatchObject({ kind: 'both', owed: 100n, owe: 30n, net: 70n });
  });

  it('never adds across currencies', () => {
    const split = splitSettlePlan([t('a', 'me', 100n), t('b', 'me', 900n, 'USD')], 'me');
    expect(summariseSettlePlan(split, 'INR').owed).toBe(100n);
  });
});

describe('settleHero', () => {
  const hero = (rows: PlanTransfer[]) => {
    const split = splitSettlePlan(rows, 'me');
    return settleHero(split, summariseSettlePlan(split, 'INR'), 'INR');
  };

  it('leads with what I owe and how many payments make it up', () => {
    expect(hero([t('me', 'a', 100n), t('me', 'b', 25n)])).toEqual({
      tone: 'owe',
      amount: 125n,
      count: 2,
    });
  });

  it('leads with what I am owed', () => {
    expect(hero([t('a', 'me', 90n)])).toEqual({ tone: 'owed', amount: 90n, count: 1 });
  });

  it('is settled when I have no rows or the net is zero', () => {
    expect(hero([t('a', 'b', 10n)]).tone).toBe('settled');
    expect(hero([t('a', 'me', 50n), t('me', 'b', 50n)]).tone).toBe('settled');
  });
});
