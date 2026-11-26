import { describe, expect, it } from 'vitest';
import { monthlySpendEntries, personalHomeSpent } from '../src/personal/compute';
import type { PersonalTxn } from '../src/personal/types';

const txn = (id: string, over: Partial<PersonalTxn> = {}): PersonalTxn => ({
  id,
  kind: 'expense',
  amount: 100n,
  currency: 'INR',
  category: null,
  note: null,
  date: '2026-11-04',
  loanId: null,
  recurringId: null,
  ...over,
});

describe('monthlySpendEntries', () => {
  it('matches Home Spent and excludes investments, loan payments, tombstones, other months and currencies', () => {
    const rows = [
      txn('daily'),
      txn('investment', { category: 'inv.fund' }),
      txn('loan', { loanId: 'l1' }),
      txn('deleted', { deletedAt: '2026-11-05' } as Partial<PersonalTxn>),
      txn('old', { date: '2026-10-31' }),
      txn('usd', { currency: 'USD' }),
    ];
    expect(monthlySpendEntries(rows, '2026-11', 'INR').map((row) => row.id)).toEqual(['daily']);
    expect(personalHomeSpent(rows, '2026-11', 'INR')).toBe(100n);
  });
});
