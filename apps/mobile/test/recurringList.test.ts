import { describe, expect, it } from 'vitest';

import {
  nextDateLabel,
  recurringTab,
  ruleTimeline,
  sectionRecurrings,
} from '../src/lib/recurringList';
import type { PersonalRecurring, PersonalTxn } from '@waves/core';

const rule = (
  id: string,
  txnKind: 'income' | 'expense',
  nextDate: string,
  amount: bigint,
): PersonalRecurring => ({
  id,
  txnKind,
  amount,
  currency: 'INR',
  category: null,
  note: null,
  cadence: 'monthly',
  interval: 1,
  secondDay: null,
  anchorDate: nextDate,
  nextDate,
  endDate: null,
  autoPost: false,
  active: true,
});

describe('recurring list helpers', () => {
  it('sections by kind, sorts by due date, and totals monthly equivalents', () => {
    const result = sectionRecurrings([
      rule('later', 'expense', '2027-01-01', 200n),
      rule('salary', 'income', '2026-12-01', 300n),
      rule('earlier', 'expense', '2026-11-25', 100n),
    ]);
    expect(result.income.map((r) => r.id)).toEqual(['salary']);
    expect(result.expense.map((r) => r.id)).toEqual(['earlier', 'later']);
    expect(result.incomeTotal).toBe(300n);
    expect(result.expenseTotal).toBe(300n);
  });

  it('omits the year within twelve months and includes it beyond twelve months', () => {
    expect(nextDateLabel('2027-03-01', 'en-GB', '2026-11-22')).toBe('1 Mar');
    expect(nextDateLabel('2028-01-01', 'en-GB', '2026-11-22')).toBe('1 Jan 2028');
  });
});

describe('ruleTimeline', () => {
  it('shows a payment made early for a rule that starts in the future', () => {
    const r = { ...rule('r1', 'expense', '2027-01-01', 15000n), anchorDate: '2026-12-01' };
    const paid = {
      id: 't1',
      recurringId: 'r1',
      date: '2026-12-01',
      amount: 15000n,
    } as unknown as PersonalTxn;
    const rows = ruleTimeline(r, [paid], '2026-11-25', 5);
    expect(rows.map((o) => [o.periodKey, o.status])).toEqual([
      ['2026-12', 'received'],
      ['2027-01', 'future'],
    ]);
  });
});

describe('recurringTab', () => {
  const rule = (id: string, txnKind: 'income' | 'expense', active: boolean, nextDate: string) =>
    ({ id, txnKind, active, nextDate }) as never;
  const rules = [
    rule('a', 'expense', false, '2027-01-01'),
    rule('b', 'expense', true, '2027-03-01'),
    rule('c', 'income', true, '2027-02-01'),
    rule('d', 'expense', true, '2027-02-01'),
  ];
  it('counts and lists one kind, active by due date first, paused last', () => {
    const out = recurringTab(rules, 'expense');
    expect(out.counts).toEqual({ expense: 3, income: 1 });
    expect(out.rules.map((r) => r.id)).toEqual(['d', 'b', 'a']);
    expect(recurringTab(rules, 'income').rules.map((r) => r.id)).toEqual(['c']);
  });
});
