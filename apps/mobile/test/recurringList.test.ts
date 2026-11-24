import { describe, expect, it } from 'vitest';

import { nextDateLabel, sectionRecurrings } from '../src/lib/recurringList';
import type { PersonalRecurring } from '@waves/core';

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
