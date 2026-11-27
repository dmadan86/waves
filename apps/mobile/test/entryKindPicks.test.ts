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
  it('keeps a custom tag when the same kind is tapped again', () => {
    expect(categoryAfterKindChange('my-tag', 'income', 'income')).toBe('my-tag');
    expect(categoryAfterKindChange('my-tag', 'income', 'expense')).toBeNull();
  });
  it('drops a spend category when switching to income, and the reverse', () => {
    expect(categoryAfterKindChange('food', 'expense', 'income')).toBeNull();
    expect(categoryAfterKindChange('inc.salary', 'income', 'expense')).toBeNull();
  });
  it('keeps a null, and a pick when the kind did not change', () => {
    expect(categoryAfterKindChange(null, 'expense', 'income')).toBeNull();
    expect(categoryAfterKindChange('food', 'expense', 'expense')).toBe('food');
  });
});
