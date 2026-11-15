import { describe, expect, it } from 'vitest';

import { canAddSharedExpense } from '../src/group/sharedExpense';

describe('canAddSharedExpense', () => {
  it('allows ordinary groups', () => {
    for (const type of ['trip', 'home', 'event', 'other', null, undefined])
      expect(canAddSharedExpense({ type })).toBe(true);
  });
  it('refuses company, archived and missing groups', () => {
    expect(canAddSharedExpense({ type: 'company' })).toBe(false);
    expect(canAddSharedExpense({ type: 'trip', archived_at: '2026-01-01' })).toBe(false);
    expect(canAddSharedExpense(null)).toBe(false);
  });
});
