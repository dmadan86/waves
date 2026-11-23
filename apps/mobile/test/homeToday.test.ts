import { describe, expect, it } from 'vitest';

import {
  capSpaces,
  plainAmount,
  rankNeeds,
  type BillNeed,
  type PersonNeed,
} from '../src/lib/homeToday';

const bill = (
  key: string,
  inDays: number,
  source: 'personal' | 'group' = 'personal',
): BillNeed => ({
  key,
  source,
  title: key,
  amount: 100n,
  currency: 'INR',
  inDays,
  date: '2026-11-21',
  ruleId: key,
});
const person = (key: string, amount: bigint): PersonNeed => ({
  key,
  name: key,
  amount,
  currency: 'INR',
  groupId: 'g',
  memberId: key,
  personKey: key,
});

describe('rankNeeds', () => {
  it('orders overdue, soon, owed, owe, review and caps at three', () => {
    const r = rankNeeds({
      bills: [bill('later', 9), bill('soon', 2), bill('late', -4)],
      owedToYou: [person('a', 500n)],
      youOwe: [person('b', 900n)],
      reviewCount: 2,
    });
    expect(r.items.map((n) => n.key)).toEqual(['late', 'soon', 'owed:a']);
    expect(r.total).toBe(5);
  });

  it('is empty when nothing qualifies', () => {
    const r = rankNeeds({ bills: [bill('far', 10)], owedToYou: [], youOwe: [], reviewCount: 0 });
    expect(r).toEqual({ items: [], total: 0 });
  });

  it('gives personal bills Mark paid and group bills Pay', () => {
    const r = rankNeeds({
      bills: [bill('p', 0), bill('g', 1, 'group')],
      owedToYou: [],
      youOwe: [],
      reviewCount: 0,
    });
    expect(r.items.map((n) => n.action)).toEqual(['markPaid', 'pay']);
  });

  it('puts the biggest debt first and skips zero amounts', () => {
    const r = rankNeeds({
      bills: [],
      owedToYou: [person('small', 10n), person('big', 99n), person('zero', 0n)],
      youOwe: [],
      reviewCount: 0,
    });
    expect(r.items.map((n) => n.key)).toEqual(['owed:big', 'owed:small']);
  });
});

describe('capSpaces', () => {
  it('shows seven and flags the rest', () => {
    expect(capSpaces([1, 2, 3, 4, 5, 6, 7, 8])).toEqual({
      shown: [1, 2, 3, 4, 5, 6, 7],
      more: true,
    });
    expect(capSpaces([1, 2]).more).toBe(false);
  });
});

describe('plainAmount', () => {
  it('drops a bare .00 but keeps real paise', () => {
    expect(plainAmount(1880000n, 'INR', 'en-IN')).not.toMatch(/\.00/);
    expect(plainAmount(1880050n, 'INR', 'en-IN')).toMatch(/\.50/);
  });
});
