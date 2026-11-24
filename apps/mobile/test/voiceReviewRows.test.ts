import { describe, expect, it } from 'vitest';
import { payerRowValue, splitRowValue, voiceExpenseAmounts } from '@/lib/voiceReviewRows';

const words = {
  equally: 'Equally · {count} people',
  shares: 'By shares · {count} people',
  percent: 'By % · {count} people',
  amounts: 'By amounts · {count} people',
};

describe('voice review row values', () => {
  it('shows split mode and count without names', () => {
    expect(splitRowValue({ kind: 'shares', weights: { a: 1, b: 2, c: 1 } }, 3, words)).toBe(
      'By shares · 3 people',
    );
    expect(splitRowValue({ kind: 'equal' }, 4, words)).toBe('Equally · 4 people');
    expect(splitRowValue({ kind: 'percent', basisPoints: {} }, 2, words)).toBe('By % · 2 people');
    expect(splitRowValue({ kind: 'exact', amounts: {} }, 2, words)).toBe('By amounts · 2 people');
  });
  it('shows You, one name, or a count for several payers', () => {
    const several = '{count} people';
    expect(payerRowValue([{ name: 'Mina' }], 'You', several)).toBe('Mina');
    expect(payerRowValue([{ name: '', isYou: true }], 'You', several)).toBe('You');
    expect(payerRowValue([{ name: 'Mina' }, { name: 'You', isYou: true }], 'You', several)).toBe(
      '2 people',
    );
  });
});

describe('voice save amounts', () => {
  const params = { kind: 'shares', weights: { a: 2, b: 1, c: 1 } } as const;
  it('two payers plus a shares split both add up to the total', () => {
    const out = voiceExpenseAmounts({
      expenseId: 'e1',
      amount: 1001n,
      currency: 'INR',
      params,
      participants: ['a', 'b', 'c'],
      payers: { a: 600n, b: 400n },
    });
    expect(out.payers.a! + out.payers.b!).toBe(1001n);
    expect(Object.values(out.expectedShares).reduce((s, v) => s + v, 0n)).toBe(1001n);
    expect(out.expectedShares.a).toBeGreaterThan(out.expectedShares.b!);
  });
  it('scales the payers to a second item with another total', () => {
    const out = voiceExpenseAmounts({
      expenseId: 'e2',
      amount: 500n,
      currency: 'INR',
      params,
      participants: ['a', 'b', 'c'],
      payers: { a: 600n, b: 400n },
    });
    expect(out.payers.a! + out.payers.b!).toBe(500n);
  });
});
