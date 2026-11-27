import { readFileSync } from 'node:fs';
import { monthlySummary, personalHomeSpent, type PersonalTxn } from '@waves/core';
import { describe, expect, it } from 'vitest';

import {
  allocateFund,
  applyFund,
  bigBills,
  classifyKind,
  dueTag,
  expandDue,
  FUND_CATEGORY,
  fundSoFar,
  filterItems,
  monthGrid,
  summarizeDue,
  type DueSource,
} from '../src/lib/moneyCalendar';

const base: DueSource = {
  id: 'r1',
  title: 'Rent',
  sub: '',
  kind: 'bill',
  amount: 1000n,
  currency: 'INR',
  cadence: 'monthly',
  interval: 1,
  secondDay: null,
  anchorDate: '2026-11-05',
  nextDate: '2026-12-05',
  endDate: null,
  autoPay: false,
  income: false,
  reserved: false,
  href: '',
};
const src = (over: Partial<DueSource>): DueSource => ({ ...base, ...over });
const TODAY = '2026-11-28';

describe('classifyKind', () => {
  it('sorts categories into loans, renewals, rent, income and bills', () => {
    expect(classifyKind('loan.emi', false, false)).toBe('loan');
    expect(classifyKind('insurance', false, false)).toBe('renewal');
    expect(classifyKind('inc.rent', true, true)).toBe('rent');
    expect(classifyKind('inc.salary', true, false)).toBe('income');
    expect(classifyKind('utilities', false, false)).toBe('bill');
    expect(classifyKind(null, false, false)).toBe('bill');
  });
});

describe('expandDue', () => {
  it('lists occurrences inside the window, soonest first', () => {
    const items = expandDue([src({})], TODAY, '2027-02-28');
    expect(items.map((i) => i.date)).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
    expect(items[0]!.inDays).toBe(7);
  });
  it('keeps one overdue occurrence, negative days', () => {
    const items = expandDue([src({ nextDate: '2026-11-20' })], TODAY, '2026-12-10');
    expect(items[0]).toMatchObject({ date: '2026-11-20', inDays: -8 });
    expect(items.map((i) => i.date)).toEqual(['2026-11-20']);
  });
  it('stops at the end date and skips reserved fund rules', () => {
    expect(expandDue([src({ endDate: '2026-12-31' })], TODAY, '2027-06-01')).toHaveLength(1);
    expect(expandDue([src({ reserved: true })], TODAY, '2027-06-01')).toHaveLength(0);
  });
});

describe('summarizeDue', () => {
  it('totals the default currency outgoing only and names the rest', () => {
    const items = expandDue(
      [
        src({ id: 'a' }),
        src({ id: 'b', amount: 500n, currency: 'USD' }),
        src({ id: 'c', income: true, kind: 'income', amount: 9n }),
      ],
      TODAY,
      '2026-12-31',
    );
    expect(summarizeDue(items, 'INR')).toEqual({ total: 1000n, count: 1, others: ['USD'] });
  });
});

describe('dueTag', () => {
  const [it0] = expandDue([src({})], TODAY, '2026-12-31');
  it('prefers overdue, auto-debit, set aside, renew, then days', () => {
    expect(dueTag({ ...it0!, inDays: -2 })).toBe('overdue');
    expect(dueTag({ ...it0!, autoPay: true })).toBe('auto');
    expect(dueTag({ ...it0!, covered: true })).toBe('setAside');
    expect(dueTag({ ...it0!, kind: 'renewal' })).toBe('renew');
    expect(dueTag(it0!)).toBe('inDays');
  });
});

describe('big bills', () => {
  const yearly = src({
    id: 'ins',
    kind: 'renewal',
    cadence: 'yearly',
    amount: 12000n,
    anchorDate: '2026-01-10',
    nextDate: '2027-01-10',
  });
  const termly = src({
    id: 'fees',
    cadence: 'monthly',
    interval: 4,
    amount: 6000n,
    anchorDate: '2026-12-01',
    nextDate: '2026-12-01',
  });
  const monthly = src({ id: 'm' });
  it('counts yearly and multi-month bills, not monthly ones', () => {
    const b = bigBills([yearly, termly, monthly], TODAY, 'INR', 100000n);
    expect(b.items.map((i) => i.sourceId).sort()).toEqual(['fees', 'ins']);
    // fees: Dec, Apr, Aug within 12 months of Nov 28; insurance: Jan.
    expect(b.total).toBe(12000n + 6000n * 3n);
    expect(b.perMonth).toBe((b.total + 11n) / 12n);
    expect(b.monthTotals).toHaveLength(12);
    expect(b.monthTotals.reduce((a, c) => a + c, 0n)).toBe(b.total);
  });
  it('treats a one-off above the threshold as big', () => {
    const oneOff = src({ id: 'x', amount: 50000n, nextDate: '2027-03-01', endDate: '2027-03-01' });
    expect(bigBills([oneOff], TODAY, 'INR', 40000n).total).toBe(50000n);
    expect(bigBills([oneOff], TODAY, 'INR', 60000n).total).toBe(0n);
  });
  it('allocates the fund to the soonest bills first', () => {
    const items = expandDue([termly, yearly], TODAY, '2027-02-01');
    const out = allocateFund(items, 7000n);
    expect(out.map((i) => !!i.covered)).toEqual([true, false]);
  });
});

describe('calendar', () => {
  const items = expandDue(
    [src({}), src({ id: 'l', kind: 'loan', nextDate: '2026-12-22', anchorDate: '2026-12-22' })],
    TODAY,
    '2026-12-31',
  );
  it('marks due days on a Monday-first grid', () => {
    const grid = monthGrid('2026-12', items);
    // 1 Dec 2026 is a Tuesday: one leading blank.
    expect(grid[0]).toBeNull();
    const five = grid.find((c) => c?.day === 5);
    expect(five?.kinds).toEqual(['bill']);
    expect(grid.find((c) => c?.day === 22)?.kinds).toEqual(['loan']);
    expect(grid.filter((c) => c !== null)).toHaveLength(31);
  });
  it('filters by kind', () => {
    expect(filterItems(items, 'loans')).toHaveLength(1);
    expect(filterItems(items, 'all')).toHaveLength(2);
  });
});

describe('Home v2 wiring', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  it('Personal and family homes both draw ComingUpHome, scoped by space', () => {
    expect(read('src/app/(tabs)/me.tsx')).toContain('<ComingUpHome');
    const hh = read('src/components/household/HouseholdScreen.tsx');
    expect(hh).toContain('<ComingUpHome');
    expect(hh).toContain('groupId={groupId}');
  });
  it('registers the calendar and big bills routes for Personal and spaces', () => {
    const layout = read('src/app/_layout.tsx');
    for (const r of [
      'personal/calendar',
      'personal/bigbills',
      'group/[id]/calendar',
      'group/[id]/bigbills',
    ])
      expect(layout).toContain(`name="${r}"`);
  });
  it('shows no floating button on the calendar screens', () => {
    expect(read('src/components/home/MoneyCalendar.tsx')).not.toMatch(/position: 'absolute'/);
  });
});

describe('set aside for big bills', () => {
  const txn = (over: Partial<PersonalTxn>): PersonalTxn =>
    ({
      id: 't',
      kind: 'expense',
      amount: 100n,
      currency: 'INR',
      category: 'food',
      note: null,
      date: '2026-11-10',
      loanId: null,
      recurringId: null,
      ...over,
    }) as PersonalTxn;
  const spend = txn({ id: 'a', amount: 41800n });
  const aside = txn({ id: 'b', amount: 2050000n, category: FUND_CATEGORY, recurringId: 'fund' });
  it('is not spending, but moves the big bills fund', () => {
    expect(personalHomeSpent([spend, aside], '2026-11', 'INR')).toBe(41800n);
    expect(monthlySummary([spend, aside], '2026-11', 'INR').invested).toBe(2050000n);
    expect(fundSoFar([spend], new Set(['fund']), 'INR')).toBe(0n);
    expect(fundSoFar([spend, aside], new Set(['fund']), 'INR')).toBe(2050000n);
  });
});

describe('big bills window and fund', () => {
  it('counts a yearly bill due today once, in one bar', () => {
    const due = src({
      id: 'y',
      cadence: 'yearly',
      amount: 18000n,
      anchorDate: '2025-11-28',
      nextDate: TODAY,
    });
    const b = bigBills([due], TODAY, 'INR', 10n ** 9n);
    expect(b.total).toBe(18000n);
    expect(b.monthTotals.filter((v) => v > 0n)).toEqual([18000n]);
    expect(b.monthTotals.reduce((a, c) => a + c, 0n)).toBe(b.total);
  });
  it('spends the fund on big bills only, never on ordinary ones', () => {
    const electricity = src({
      id: 'e',
      amount: 3000n,
      nextDate: '2026-12-02',
      anchorDate: '2026-12-02',
    });
    const insurance = src({
      id: 'i',
      kind: 'renewal',
      cadence: 'yearly',
      amount: 18000n,
      anchorDate: '2026-01-15',
      nextDate: '2027-01-15',
    });
    const items = expandDue([electricity, insurance], TODAY, '2027-02-01');
    const big = bigBills([electricity, insurance], TODAY, 'INR', 10n ** 9n);
    const out = applyFund(items, big.occurrences, 20000n);
    expect(out.map((i) => [i.sourceId, !!i.covered])).toEqual([
      ['e', false],
      ['i', true],
    ]);
  });
});
