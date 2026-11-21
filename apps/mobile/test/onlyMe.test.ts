import { describe, expect, it } from 'vitest';

import { canOfferOnlyMe, onlyMeRecord } from '../src/lib/onlyMePure';

describe('canOfferOnlyMe', () => {
  it('is for new expenses in couple and home groups only', () => {
    expect(canOfferOnlyMe({ groupType: 'couple', editing: false })).toBe(true);
    expect(canOfferOnlyMe({ groupType: 'home', editing: false })).toBe(true);
    expect(canOfferOnlyMe({ groupType: 'couple', editing: true })).toBe(false);
    expect(canOfferOnlyMe({ groupType: 'trip', editing: false })).toBe(false);
    expect(canOfferOnlyMe({ groupType: undefined, editing: false })).toBe(false);
  });
});

describe('onlyMeRecord', () => {
  it('is a personal txn, never a group write', () => {
    const record = onlyMeRecord({
      amount: 12000n,
      currency: 'INR',
      category: 'food',
      description: '  Gift  ',
      date: '2026-11-21',
      paymentMethod: 'cash',
    });
    expect(record.recordKind).toBe('txn');
    expect(record.recordId).toBeUndefined();
    expect(JSON.stringify(record.data)).toContain('Gift');
  });
});
