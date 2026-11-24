import { describe, expect, it } from 'vitest';

import type { PersonalLoan, PersonalRecurring, PersonalTxn } from '@waves/core';

import { monthBreakdown } from '../src/lib/personalMonthBreakdown';

const txn = (over: Partial<PersonalTxn>): PersonalTxn =>
  ({
    id: Math.random().toString(),
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

const loan = (over: Partial<PersonalLoan>): PersonalLoan =>
  ({
    id: 'L1',
    direction: 'borrowed',
    counterpart: 'Bank',
    principal: 1000n,
    currency: 'INR',
    note: null,
    startDate: '2026-01-01',
    status: 'active',
    ...over,
  }) as PersonalLoan;

const rule = (over: Partial<PersonalRecurring>): PersonalRecurring =>
  ({
    id: 'R1',
    txnKind: 'expense',
    amount: 500n,
    currency: 'INR',
    category: 'bills',
    note: null,
    cadence: 'monthly',
    interval: 1,
    secondDay: null,
    anchorDate: '2026-09-20',
    nextDate: '2026-11-20',
    endDate: null,
    autoPost: false,
    active: true,
    ...over,
  }) as PersonalRecurring;

const run = (t: PersonalTxn[], r: PersonalRecurring[], l: PersonalLoan[]) =>
  monthBreakdown(t, r, l, '2026-11', 'INR', '2026-11-12');

describe('monthBreakdown', () => {
  it('is all zeros for an empty ledger', () => {
    const b = run([], [], []);
    expect(b.recurring).toEqual({ expected: 0n, due: 0n, count: 0 });
    expect(b.loans).toEqual({ repaid: 0n, outstanding: 0n });
    expect(b.creditCard).toEqual({ total: 0n, count: 0 });
    expect(b.categories).toEqual({ rows: [], uncategorizedCount: 0, uncategorizedTotal: 0n });
  });

  it('counts an unpaid bill as due and ignores inactive, income and other-currency rules', () => {
    const b = run(
      [],
      [
        rule({}),
        rule({ id: 'R2', active: false }),
        rule({ id: 'R3', txnKind: 'income' }),
        rule({ id: 'R4', currency: 'USD' }),
      ],
      [],
    );
    expect(b.recurring).toEqual({ expected: 500n, due: 500n, count: 1 });
  });

  it('does not count a bill that a real entry claimed as still due', () => {
    const b = run([txn({ amount: 500n, date: '2026-11-20', recurringId: 'R1' })], [rule({})], []);
    expect(b.recurring.expected).toBe(500n);
    expect(b.recurring.count).toBe(1);
    expect(b.recurring.due).toBe(0n);
  });

  it('sums repayments on borrowed loans only, and outstanding on active ones', () => {
    const b = run(
      [
        txn({ amount: 200n, loanId: 'L1' }),
        txn({ amount: 50n, loanId: 'L2' }),
        txn({ amount: 70n, loanId: 'L1', date: '2026-10-10' }),
      ],
      [],
      [
        loan({}),
        loan({ id: 'L2', direction: 'lent' }),
        loan({ id: 'L3', status: 'closed' }),
        loan({ id: 'L4', currency: 'USD' }),
      ],
    );
    expect(b.loans.repaid).toBe(200n);
    expect(b.loans.outstanding).toBe(730n);
  });

  it('totals credit-card spend (and the legacy card value), ignoring other methods', () => {
    const b = run(
      [
        txn({ amount: 300n, paymentMethod: 'credit' }),
        txn({ amount: 20n, paymentMethod: 'card' }),
        txn({ amount: 9n, paymentMethod: 'cash' }),
        txn({ amount: 9n, paymentMethod: 'credit', kind: 'income' }),
      ],
      [],
      [],
    );
    expect(b.creditCard).toEqual({ total: 320n, count: 2 });
  });

  it('ignores txns in another currency or month', () => {
    const b = run(
      [
        txn({ currency: 'USD', paymentMethod: 'credit', loanId: 'L1', category: null }),
        txn({ date: '2026-10-31', paymentMethod: 'credit', category: null }),
      ],
      [],
      [loan({})],
    );
    expect(b.creditCard.count).toBe(0);
    expect(b.loans.repaid).toBe(0n);
    expect(b.categories.rows).toEqual([]);
    expect(b.categories.uncategorizedCount).toBe(0);
  });

  it('ranks categories and counts uncategorised entries', () => {
    const b = run(
      [
        txn({ amount: 100n, category: 'food' }),
        txn({ amount: 400n, category: 'travel' }),
        txn({ amount: 30n, category: null }),
        txn({ amount: 20n, category: null }),
      ],
      [],
      [],
    );
    expect(b.categories.rows[0]).toMatchObject({ category: 'travel', spent: 400n });
    expect(b.categories.uncategorizedCount).toBe(2);
    expect(b.categories.uncategorizedTotal).toBe(50n);
  });
});
