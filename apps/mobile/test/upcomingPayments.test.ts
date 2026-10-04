/**
 * "Upcoming payments" (docs/event-organizer.md): which vendor deposits still
 * owe a balance, soonest/overdue first.
 */

import { describe, expect, it } from 'vitest';

import { overdueCount, upcomingPayments, type DepositCandidate } from '../src/lib/upcomingPayments';

const deposit = (overrides: Partial<DepositCandidate> = {}): DepositCandidate => ({
  expenseId: 'e1',
  description: 'Decorator deposit',
  currency: 'inr',
  isDeposit: true,
  balanceDueMinor: 150000n,
  balanceDueDate: '2027-02-10',
  ...overrides,
});

describe('upcomingPayments', () => {
  it('drops anything that is not a deposit still owing a positive balance', () => {
    const rows = upcomingPayments(
      [
        deposit({ expenseId: 'not-a-deposit', isDeposit: false }),
        deposit({ expenseId: 'no-balance', balanceDueMinor: null }),
        deposit({ expenseId: 'zero-balance', balanceDueMinor: 0n }),
        deposit({ expenseId: 'negative-balance', balanceDueMinor: -100n }),
        deposit({ expenseId: 'real-one' }),
      ],
      '2027-01-01',
    );
    expect(rows.map((r) => r.expenseId)).toEqual(['real-one']);
  });

  it('upper-cases the currency, same as the rest of the ledger', () => {
    const [row] = upcomingPayments([deposit({ currency: 'inr' })], '2027-01-01');
    expect(row?.currency).toBe('INR');
  });

  it('flags a payment overdue only once its due date is strictly before today', () => {
    const rows = upcomingPayments(
      [
        deposit({ expenseId: 'due', balanceDueDate: '2027-02-10' }),
        deposit({ expenseId: 'dueToday', balanceDueDate: '2027-01-01' }),
        deposit({ expenseId: 'overdue', balanceDueDate: '2026-12-01' }),
      ],
      '2027-01-01',
    );
    const by = (id: string) => rows.find((r) => r.expenseId === id);
    expect(by('due')?.overdue).toBe(false);
    expect(by('dueToday')?.overdue).toBe(false);
    expect(by('overdue')?.overdue).toBe(true);
  });

  it('never calls a date-less balance overdue — there is nothing to have missed', () => {
    const [row] = upcomingPayments([deposit({ balanceDueDate: null })], '2099-01-01');
    expect(row?.overdue).toBe(false);
  });

  it('sorts soonest-due first, a date-less balance last, ties by description', () => {
    const rows = upcomingPayments(
      [
        deposit({ expenseId: 'no-date', description: 'Z', balanceDueDate: null }),
        deposit({ expenseId: 'late', description: 'B', balanceDueDate: '2027-03-01' }),
        deposit({ expenseId: 'early', description: 'A', balanceDueDate: '2027-01-15' }),
        deposit({ expenseId: 'same-day-b', description: 'B', balanceDueDate: '2027-03-01' }),
      ],
      '2027-01-01',
    );
    expect(rows.map((r) => r.expenseId)).toEqual(['early', 'late', 'same-day-b', 'no-date']);
  });
});

describe('overdueCount', () => {
  it('counts only the overdue rows', () => {
    const rows = upcomingPayments(
      [
        deposit({ expenseId: 'a', balanceDueDate: '2026-01-01' }),
        deposit({ expenseId: 'b', balanceDueDate: '2099-01-01' }),
        deposit({ expenseId: 'c', balanceDueDate: '2026-02-01' }),
      ],
      '2027-01-01',
    );
    expect(overdueCount(rows)).toBe(2);
  });

  it('is zero for an empty list', () => {
    expect(overdueCount([])).toBe(0);
  });
});
