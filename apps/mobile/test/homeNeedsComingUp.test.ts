import type { PersonalRecurring } from '@waves/core';
import { describe, expect, it } from 'vitest';

import {
  isAutoPostOverdue,
  notExcluded,
  personalNeedKey,
  rankNeeds,
  shownPersonalKeys,
  SOON_DAYS,
  type BillNeed,
  type PersonNeed,
} from '../src/lib/homeToday';
import { billRows } from '../src/lib/personalUpcoming';

const bill = (key: string, inDays: number, source: 'personal' | 'group' = 'personal'): BillNeed => ({
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
const none = { bills: [], owedToYou: [], youOwe: [], reviewCount: 0 };

const rule = (id: string, patch: Partial<PersonalRecurring> = {}): PersonalRecurring => ({
  id,
  txnKind: 'expense',
  amount: 200_000n,
  currency: 'INR' as PersonalRecurring['currency'],
  category: null,
  note: id,
  cadence: 'monthly',
  interval: 1,
  secondDay: null,
  anchorDate: '2026-10-02',
  nextDate: '2026-11-02',
  endDate: null,
  autoPost: false,
  active: true,
  ...patch,
});

describe('rankNeeds ordering and counts', () => {
  it('ranks all five kinds when the limit is lifted', () => {
    const r = rankNeeds(
      {
        bills: [bill('later', 9), bill('s', 2), bill('o', -4)],
        owedToYou: [person('a', 5n)],
        youOwe: [person('b', 9n)],
        reviewCount: 2,
      },
      Infinity,
    );
    expect(r.items.map((n) => n.kind)).toEqual(['overdue', 'soon', 'owed', 'owe', 'review']);
    expect(r.total).toBe(5);
    expect(r.items[4]?.count).toBe(2);
  });

  it('sorts overdue most-late first and breaks ties by key', () => {
    const r = rankNeeds(
      { ...none, bills: [bill('b', -1), bill('z', -9), bill('a', -1)] },
      Infinity,
    );
    expect(r.items.map((n) => n.key)).toEqual(['z', 'a', 'b']);
  });

  it('treats today and exactly SOON_DAYS as soon, SOON_DAYS+1 as neither', () => {
    const r = rankNeeds(
      { ...none, bills: [bill('t', 0), bill('edge', SOON_DAYS), bill('out', SOON_DAYS + 1)] },
      Infinity,
    );
    expect(r.items.map((n) => [n.key, n.kind])).toEqual([
      ['t', 'soon'],
      ['edge', 'soon'],
    ]);
  });

  it('total counts everything that qualifies, not only what is shown', () => {
    const r = rankNeeds({ ...none, bills: [bill('a', -1), bill('b', -2), bill('c', 0), bill('d', 1)] });
    expect(r.items).toHaveLength(3);
    expect(r.total).toBe(4);
  });

  it('honours a custom limit of 0 and 1', () => {
    const input = { ...none, bills: [bill('a', -1)], reviewCount: 1 };
    expect(rankNeeds(input, 0)).toMatchObject({ items: [], total: 2 });
    expect(rankNeeds(input, 1).items.map((n) => n.key)).toEqual(['a']);
  });

  it('owe direction uses the pay action and the owe: key prefix; negative amounts are dropped', () => {
    const r = rankNeeds({ ...none, youOwe: [person('x', 7n), person('neg', -3n)] });
    expect(r.items.map((n) => [n.key, n.action])).toEqual([['owe:x', 'pay']]);
  });

  it('equal debts order by key so the list does not flicker', () => {
    const r = rankNeeds({ ...none, owedToYou: [person('b', 5n), person('a', 5n)] });
    expect(r.items.map((n) => n.key)).toEqual(['owed:a', 'owed:b']);
  });

  it('does not mutate its input arrays', () => {
    const bills = [bill('b', 2), bill('a', -1)];
    rankNeeds({ ...none, bills });
    expect(bills.map((b) => b.key)).toEqual(['b', 'a']);
  });
});

describe('auto-post overdue skip', () => {
  const rules = new Map([
    ['auto', { autoPost: true }],
    ['hand', { autoPost: false }],
  ]);
  it('skips only overdue rows of auto-post rules', () => {
    expect(isAutoPostOverdue({ inDays: -1, ruleId: 'auto' }, rules)).toBe(true);
    expect(isAutoPostOverdue({ inDays: 0, ruleId: 'auto' }, rules)).toBe(false);
    expect(isAutoPostOverdue({ inDays: 2, ruleId: 'auto' }, rules)).toBe(false);
    expect(isAutoPostOverdue({ inDays: -5, ruleId: 'hand' }, rules)).toBe(false);
    expect(isAutoPostOverdue({ inDays: -5, ruleId: 'gone' }, rules)).toBe(false);
    expect(isAutoPostOverdue({ inDays: -5 }, rules)).toBe(false);
  });

  it('a real auto-post rule with a missed day produces an overdue row that is skipped', () => {
    const today = '2026-11-20';
    const auto = rule('auto', { autoPost: true });
    const hand = rule('hand');
    const rows = billRows([], [auto, hand], 'INR', today, SOON_DAYS);
    const byRule = new Map([auto, hand].map((r) => [r.id, r]));
    const kept = rows.filter((r) => !isAutoPostOverdue(r, byRule));
    expect(rows.some((r) => r.ruleId === 'hand' && r.inDays < 0)).toBe(true);
    expect(kept.some((r) => r.ruleId === 'auto' && r.inDays < 0)).toBe(false);
    expect(kept.some((r) => r.ruleId === 'hand' && r.inDays < 0)).toBe(true);
  });
});

describe('Needs you / Coming up de-duplication', () => {
  it('Coming up leaves out exactly the personal bills Needs you shows', () => {
    const today = '2026-11-20';
    const rules = [rule('rent', { nextDate: '2026-11-21' }), rule('gym', { nextDate: '2026-11-28' })];
    const rows = billRows([], rules, 'INR', today, 14);
    const needs = rankNeeds({
      bills: rows.map((row) => ({ ...bill(personalNeedKey(row.key), row.inDays), ruleId: row.ruleId ?? '' })),
      owedToYou: [],
      youOwe: [],
      reviewCount: 0,
    });
    const exclude = shownPersonalKeys(needs.items);
    const coming = rows.filter((r) => r.inDays >= 0 && notExcluded(r.key, exclude));
    const shownInNeeds = needs.items.map((n) => n.bill!.key.slice(2));
    expect(shownInNeeds.length).toBeGreaterThan(0);
    for (const r of coming) expect(shownInNeeds).not.toContain(r.key);
    // and a bill beyond Needs you's window still appears in Coming up
    expect(coming.map((r) => r.ruleId)).toContain('gym');
    expect(coming.filter((r) => r.ruleId === 'rent').every((r) => r.inDays > SOON_DAYS)).toBe(true);
  });

  it('shownPersonalKeys skips group bills and non-bill needs', () => {
    const r = rankNeeds({
      bills: [bill('p:r1:2026-11', 0), bill('g:r2:2026-11-21', 0, 'group')],
      owedToYou: [person('a', 1n)],
      youOwe: [],
      reviewCount: 1,
    });
    expect(shownPersonalKeys(r.items)).toBe('r1:2026-11');
  });

  it('notExcluded matches whole keys only, and an empty exclude hides nothing', () => {
    expect(notExcluded('r1:2026-11', '')).toBe(true);
    expect(notExcluded('r1:2026-11', 'r1:2026-11|r2:2026-11')).toBe(false);
    expect(notExcluded('r1:2026-11', 'r1:2026-11x|r2:2026-11')).toBe(true);
    expect(notExcluded('r2', 'r22')).toBe(true);
  });

  it('the Needs key is the Coming up key with a p: prefix', () => {
    expect(personalNeedKey('r1:2026-11')).toBe('p:r1:2026-11');
  });
});
