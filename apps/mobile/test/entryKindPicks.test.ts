import { describe, expect, it } from 'vitest';

import { categoryAfterKindChange, quickPickIds } from '../src/lib/personalEntry';

describe('quickPickIds', () => {
  it('offers the everyday spend categories for an expense', () => {
    expect(quickPickIds('expense')).toEqual(['food', 'shopping', 'travel', 'home', 'health']);
  });
  it('offers the usual income sources for an income', () => {
    expect(quickPickIds('income')).toEqual([
      'inc.salary',
      'inc.business',
      'inc.freelance',
      'inc.rent',
      'inc.interest',
    ]);
  });
});

describe('categoryAfterKindChange', () => {
  it('drops a spend category when switching to income, and the reverse', () => {
    expect(categoryAfterKindChange('food', 'income')).toBeNull();
    expect(categoryAfterKindChange('inc.salary', 'expense')).toBeNull();
  });
  it('keeps one that belongs to the new kind, and a null', () => {
    expect(categoryAfterKindChange('inc.salary', 'income')).toBe('inc.salary');
    expect(categoryAfterKindChange('food', 'expense')).toBe('food');
    expect(categoryAfterKindChange(null, 'income')).toBeNull();
  });
});
