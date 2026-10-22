import { describe, expect, it } from 'vitest';
import {
  familyStatement,
  formatFamilyStatement,
  SettlementStatus,
  type FamilyStatementExpense,
  type SettlementSnapshot,
} from '../src';

const units = {
  family: { name: 'Family', members: ['a', 'b'], head: 'b' },
  other: { name: 'Other', members: ['c'] },
};
const expense: FamilyStatementExpense = {
  id: 'e',
  description: 'Dinner',
  date: '2026-10-22',
  currency: 'INR',
  amount: 100n,
  payers: { c: 100n },
  shares: { a: 33n, b: 34n, c: 33n },
};
const payment: SettlementSnapshot = {
  id: 's',
  from: 'a',
  to: 'c',
  amount: 20n,
  currency: 'INR',
  status: SettlementStatus.Confirmed,
  at: '2026-10-22T12:00:00Z',
};
const statement = (expenses = [expense], settlements: SettlementSnapshot[] = []) =>
  familyStatement({ name: 'Trip', currency: 'INR' }, units, 'family', expenses, settlements);

describe('family statement', () => {
  it('sums stored rounded shares and settles using family heads', () => {
    const result = statement();
    expect(result.members).toEqual(['a', 'b']);
    expect(result.expenses[0]).toMatchObject({ share: 67n, paid: 0n });
    expect(result.totals).toEqual([{ currency: 'INR', paid: 0n, share: 67n, net: -67n }]);
    expect(result.transfers).toEqual([{ from: 'b', to: 'c', amount: 67n, currency: 'INR' }]);
    const text = formatFamilyStatement(result);
    expect(text).toContain('Family share: INR 0.67');
    expect(text).toContain('Family (b) → Other (c)');
    expect(text).toContain('2026-10-22 · Dinner');
  });
  it('shows confirmed settlements, ignores pending and cancels internal payments', () => {
    const internal = { ...payment, id: 'internal', to: 'b' };
    const pending = { ...payment, id: 'pending', status: SettlementStatus.Initiated };
    const result = statement([expense], [payment, internal, pending]);
    expect(result.settlements).toEqual([internal, payment]);
    expect(result.totals[0]?.net).toBe(-47n);
    expect(result.transfers[0]?.amount).toBe(47n);
    expect(formatFamilyStatement(result)).toContain('Settlements');
  });
  it('handles a family without expenses and settlement-only balances', () => {
    expect(statement([]).totals).toEqual([]);
    expect(formatFamilyStatement(statement([]))).toContain('No expenses.');
    expect(formatFamilyStatement(statement([]))).toContain('All settled.');
    expect(statement([], [payment]).totals[0]?.net).toBe(20n);
  });
  it('does not produce a phantom group-currency total when the family has only foreign-currency activity', () => {
    // Group currency is INR, but this family's only expense is in USD.
    const usdExpense: FamilyStatementExpense = {
      id: 'u',
      description: 'Hotel',
      date: '2026-10-22',
      currency: 'USD',
      amount: 200n,
      payers: { a: 200n },
      shares: { a: 100n, b: 100n },
    };
    const result = familyStatement(
      { name: 'Trip', currency: 'INR' },
      units,
      'family',
      [usdExpense],
      [],
    );
    const currencies = result.totals.map((t) => t.currency);
    expect(currencies).toEqual(['USD']);
    expect(currencies).not.toContain('INR');
  });
  it('excludes deleted bills, includes payer-only bills and separates currencies', () => {
    const paid = {
      ...expense,
      id: 'paid',
      currency: 'JPY',
      payers: { a: 100n },
      shares: { c: 100n },
    };
    const result = statement([{ ...expense, deletedAt: '2026-10-22' }, paid]);
    expect(result.expenses).toHaveLength(1);
    expect(result.totals).toContainEqual({ currency: 'JPY', paid: 100n, share: 0n, net: 100n });
    expect(formatFamilyStatement(result)).toContain('Family paid: JPY 100');
  });
});
