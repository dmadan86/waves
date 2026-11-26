import { describe, expect, it } from 'vitest';

import { personalTxnCategoryLabel } from '../src/lib/personalTxnCategoryLabel';

describe('income transaction category labels', () => {
  it('labels bonus, rent, and investment entries instead of showing Other', () => {
    const translate = (key: string) => (key === 'food' ? 'Food' : null);
    expect(personalTxnCategoryLabel('inc.bonus', translate)).toBe('Bonus');
    expect(personalTxnCategoryLabel('inc.rent', translate)).toBe('Rent received');
    expect(personalTxnCategoryLabel('inv.deposit', translate)).toBe('Investment deposit');
    expect(personalTxnCategoryLabel('food', translate)).toBe('Food');
    expect(personalTxnCategoryLabel(null, translate)).toBeNull();
  });
});
