import { describe, expect, it } from 'vitest';
import { parseMinorInput } from '../src/money/input';
import { loanOutstanding } from '../src/personal/compute';
import type { PersonalLoan, PersonalTxn } from '../src/personal/types';

describe('money input and loan edge cases', () => {
  it('parses locale decimal and grouping separators', () => {
    expect(parseMinorInput('12,50', 'INR')).toBe(1250n);
    expect(parseMinorInput('1.234,50', 'INR')).toBe(123450n);
    expect(parseMinorInput('1,234.50', 'INR')).toBe(123450n);
    expect(parseMinorInput('1,23,456.50', 'INR')).toBe(12_345_650n);
    expect(parseMinorInput('₹ 1 234', 'INR')).toBe(123400n);
  });

  it('retains an overpayment as a negative outstanding amount', () => {
    const loan: PersonalLoan = {
      id: 'loan1',
      direction: 'lent',
      counterpart: 'A',
      principal: 100000n,
      currency: 'INR',
      note: null,
      startDate: '2026-01-01',
      status: 'active',
    };
    const txn: PersonalTxn = {
      id: 'payment',
      kind: 'income',
      amount: 120000n,
      currency: 'INR',
      category: 'other',
      note: null,
      date: '2026-01-02',
      loanId: 'loan1',
      recurringId: null,
    };
    expect(loanOutstanding(loan, [txn])).toBe(-20000n);
  });
});
