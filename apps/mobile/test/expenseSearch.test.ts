import { describe, expect, it } from 'vitest';

import { amountMatches } from '@/lib/expenseSearch';

describe('amountMatches', () => {
  it('matches whole units and the full amount', () => {
    expect(amountMatches('500', 50000n)).toBe(true);
    expect(amountMatches('283.33', 28333n)).toBe(true);
    expect(amountMatches('283', 28333n)).toBe(true);
  });
  it('ignores separators and currency symbols', () => {
    expect(amountMatches('₹1,050', 105000n)).toBe(true);
  });
  it('matches as the person types, from the start', () => {
    expect(amountMatches('10', 105000n)).toBe(true);
    expect(amountMatches('50', 105000n)).toBe(false);
  });
  it('never matches words', () => {
    expect(amountMatches('coffee', 2500n)).toBe(false);
  });
});
