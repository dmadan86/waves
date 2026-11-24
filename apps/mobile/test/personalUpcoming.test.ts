import { describe, expect, it } from 'vitest';

import type { PersonalRecurring, PersonalTxn } from '@waves/core';

import {
  addMonths,
  billsInMonth,
  daysBetween,
  hasDue,
  mergeUpcoming,
  monthOptions,
  recurringRows,
  groupUpcoming,
  filterUpcoming,
  upcomingView,
  type UpcomingRow,
} from '../src/lib/personalUpcoming';

const row = (key: string, inDays: number): UpcomingRow => ({
  key,
  kind: 'bill',
  tone: 'brand',
  inDays,
  date: null,
});

describe('personal upcoming', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-11-16', '2026-11-21')).toBe(5);
    expect(daysBetween('2026-11-21', '2026-11-20')).toBe(-1);
  });

  it('sorts by date and limits without adding the setup to-do', () => {
    const rows = mergeUpcoming([row('c', 9), row('a', 1), row('b', 4)], 2);
    expect(rows.map((r) => r.key)).toEqual(['a', 'b']);
  });

  it('fills three rows without a to-do, and lists everything with no limit', () => {
    const dated = [row('a', 1), row('b', 2), row('c', 3), row('d', 4)];
    expect(mergeUpcoming(dated, 3).map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(mergeUpcoming(dated, 0)).toHaveLength(4);
  });

  it('dots the bell for anything due by tomorrow, not the to-do', () => {
    expect(hasDue([row('a', 3)])).toBe(false);
    expect(hasDue([row('a', -2)])).toBe(true);
    expect(hasDue(mergeUpcoming([], 3))).toBe(false);
  });
});

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
const paid = (r: PersonalRecurring, date: string): PersonalTxn =>
  ({
    id: `t-${date}`,
    kind: 'expense',
    amount: r.amount,
    currency: r.currency,
    date,
    recurringId: r.id,
  }) as PersonalTxn;

describe('upcoming screen helpers', () => {
  const today = '2026-11-21';
  const aunty = rule('aunty');
  const phone = rule('phone', { anchorDate: '2026-10-25', amount: 300_000n });
  const salary = rule('salary', { txnKind: 'income' });

  it('shifts months across a year end', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthOptions(today)).toHaveLength(12);
    expect(monthOptions(today)[2]).toBe('2026-11');
  });

  it('flags an unpaid manual bill whose day has passed as overdue; a linked txn pays it', () => {
    const rows = billsInMonth([], [aunty, phone], 'INR', '2026-11', today);
    expect(rows.map((r) => [r.title, r.overdue])).toEqual([
      ['aunty', true],
      ['phone', false],
    ]);
    const after = billsInMonth([paid(aunty, '2026-11-21')], [aunty], 'INR', '2026-11', today);
    expect(after).toHaveLength(0);
  });

  it('never calls an auto-post rule overdue', () => {
    const rows = billsInMonth([], [{ ...aunty, autoPost: true }], 'INR', '2026-11', today);
    expect(rows[0]?.overdue).toBe(false);
  });

  it('groups this month vs next and excludes setup to-dos', () => {
    const view = upcomingView({
      txns: [],
      recurrings: [aunty, phone, salary],
      currency: 'INR',
      today,
      dates: [],
    });
    expect(view.rows.length).toBe(8);
    expect(view.rows.some((r) => r.key === 'todo')).toBe(false);
    const grouped = groupUpcoming(view.rows, today);
    expect(grouped.overdue).toHaveLength(2);
    expect(grouped.thisWeek).toHaveLength(1);
    expect(grouped.laterThisMonth).toHaveLength(0);
    expect(grouped.nextMonth).toHaveLength(3);
    expect(filterUpcoming(view, 'bills').every((r) => !r.income)).toBe(true);
  });

  it('lists every active rule, income too, on the recurring tab', () => {
    expect(
      recurringRows([aunty, salary, rule('off', { active: false })], 'INR', today),
    ).toHaveLength(2);
  });
});
