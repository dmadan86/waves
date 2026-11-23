import { describe, expect, it } from 'vitest';

import {
  billPayer,
  billWhen,
  compactAmount,
  monthProgress,
  monthSpend,
} from '../src/lib/householdHome';
import {
  addDays,
  groupBillsForPayer,
  planBillReminders,
  type PayerBill,
} from '../src/lib/householdBills';

describe('monthSpend / monthProgress', () => {
  it('sums only that month and currency', () => {
    const rows = [
      { date: '2026-11-03', amount: 100n, currency: 'INR' },
      { date: '2026-10-30', amount: 50n, currency: 'INR' },
      { date: '2026-11-09', amount: 70n, currency: 'USD' },
    ];
    expect(monthSpend(rows, '2026-11', 'INR')).toBe(100n);
  });
  it('is on track under budget, over past it, and quiet with no budget', () => {
    expect(monthProgress(4230000n, 6000000n)).toMatchObject({ left: 1770000n, onTrack: true });
    expect(monthProgress(7000n, 6000n)).toMatchObject({
      over: 1000n,
      left: 0n,
      onTrack: false,
      fraction: 1,
    });
    expect(monthProgress(5n, null).hasBudget).toBe(false);
  });
});

describe('billWhen / billPayer', () => {
  it('names a monthly bill by date and others by cadence', () => {
    expect(billWhen({ cadence: 'monthly', interval: 1, nextDate: '2026-12-01' })).toEqual({
      kind: 'date',
      date: '2026-12-01',
    });
    expect(billWhen({ cadence: 'monthly', interval: 3, nextDate: '2026-12-01' })).toEqual({
      kind: 'every',
      every: 'months',
      n: 3,
    });
    expect(billWhen({ cadence: 'weekly', interval: 1, nextDate: '2026-12-01' }).kind).toBe('every');
  });
  it('picks the biggest payer', () => {
    expect(billPayer({ a: 10n, b: 30n })).toBe('b');
    expect(billPayer({})).toBeNull();
  });
});

const rule = (over: Record<string, unknown>) =>
  ({
    id: 'r1',
    groupId: 'g1',
    description: 'Rent',
    currency: 'INR',
    amount: 100n,
    payers: { me: 100n },
    nextDate: '2026-12-01',
    status: 'active',
    cadence: 'monthly',
    interval: 1,
    ...over,
  }) as never;

describe('groupBillsForPayer', () => {
  it('keeps only active bills the viewer pays, soonest first', () => {
    const rules = [
      rule({ id: 'a', nextDate: '2026-12-09' }),
      rule({ id: 'b', payers: { other: 100n } }),
      rule({ id: 'c', status: 'paused' }),
      rule({ id: 'd', nextDate: '2026-12-02' }),
    ];
    expect(groupBillsForPayer(rules, 'me').map((b) => b.ruleId)).toEqual(['d', 'a']);
    expect(
      groupBillsForPayer(rules, 'me', { today: '2026-12-01', horizonDays: 3 }).map((b) => b.ruleId),
    ).toEqual(['d']);
    expect(groupBillsForPayer(rules, null)).toEqual([]);
  });
});

describe('planBillReminders', () => {
  const bill = (id: string, date: string): PayerBill => ({
    ruleId: id,
    groupId: 'g',
    description: id,
    amount: 1n,
    currency: 'INR',
    date,
  });
  const now = new Date(2026, 10, 21, 8, 0);

  it('plans 3 days before and on the day at 10:00', () => {
    const plan = planBillReminders([bill('rent', '2026-12-01')], [], now);
    expect(plan.add.map((r) => [r.kind, r.at.getDate(), r.at.getHours()])).toEqual([
      ['today', 1, 10],
      ['ahead', 28, 10],
    ]);
  });
  it('never plans the past and skips a lead already gone', () => {
    const plan = planBillReminders([bill('x', '2026-11-22')], [], now);
    expect(plan.add.map((r) => r.kind)).toEqual(['today']);
  });
  it('allows at most one reminder per day, day-of first', () => {
    const plan = planBillReminders([bill('a', '2026-12-04'), bill('b', '2026-12-01')], [], now);
    const days = plan.add.map((r) => `${r.at.getMonth()}-${r.at.getDate()}`);
    expect(new Set(days).size).toBe(days.length);
    // a's lead (1 Dec) collides with b's day-of: b wins.
    expect(plan.add.find((r) => r.at.getDate() === 1)?.bill.ruleId).toBe('b');
  });
  it('is idempotent against what is already scheduled and cancels stale alarms', () => {
    const first = planBillReminders([bill('rent', '2026-12-01')], [], now);
    const held = first.add.map((r, i) => ({
      identifier: `i${i}`,
      key: r.key,
      fireAt: r.at.getTime(),
    }));
    expect(planBillReminders([bill('rent', '2026-12-01')], held, now)).toEqual({
      add: [],
      cancel: [],
    });
    const stopped = planBillReminders([], held, now);
    expect(stopped.cancel.sort()).toEqual(['i0', 'i1']);
  });
  it('addDays crosses months', () => {
    expect(addDays('2026-12-01', -3)).toBe('2026-11-28');
  });
});

describe('compactAmount', () => {
  it('drops a bare .00 but keeps real paise', () => {
    expect(compactAmount({ text: '₹1,200.00', lead: '₹1,200', trail: '', fraction: '00' })).toBe(
      '₹1,200',
    );
    expect(compactAmount({ text: '₹1,200.50', lead: '₹1,200', trail: '', fraction: '50' })).toBe(
      '₹1,200.50',
    );
  });
});
