import { describe, expect, it } from 'vitest';

import {
  addCategory,
  categoryOptions,
  removeCategory,
  toggleCategory,
} from '../src/lib/vendorCategories';

describe('vendor categories', () => {
  it('adds trimmed, ignores empty and case-insensitive duplicates', () => {
    expect(addCategory(['Cement'], '  Labour ')).toEqual(['Cement', 'Labour']);
    expect(addCategory(['Cement'], 'cement')).toEqual(['Cement']);
    expect(addCategory(['Cement'], '   ')).toEqual(['Cement']);
  });
  it('caps at 10 items and 40 characters', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `c${i}`);
    expect(addCategory(ten, 'extra')).toEqual(ten);
    expect(addCategory([], 'x'.repeat(50))[0]).toHaveLength(40);
  });
  it('toggles and removes', () => {
    expect(toggleCategory(['Cement'], 'Materials')).toEqual(['Cement', 'Materials']);
    expect(toggleCategory(['Cement', 'Materials'], 'cement')).toEqual(['Materials']);
    expect(removeCategory(['A', 'B'], 'a')).toEqual(['B']);
  });
  it('lists presets, and when expanded the more presets and used ones once', () => {
    expect(categoryOptions(['A'], ['B'], [['c']], false)).toEqual(['A']);
    expect(categoryOptions(['A'], ['B'], [['a', 'C'], ['c ']], true)).toEqual(['A', 'B', 'C']);
  });
});
