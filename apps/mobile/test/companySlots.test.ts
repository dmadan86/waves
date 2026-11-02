import { describe, expect, it } from 'vitest';

import { createGate, isSlotRequired, ownedCompanyCount } from '../src/lib/companySlots';

const co = (over: Record<string, unknown> = {}) => ({
  type: 'company',
  deleted_at: null,
  created_by: 'me',
  ...over,
});

describe('ownedCompanyCount', () => {
  it('counts only undeleted companies the viewer created', () => {
    expect(
      ownedCompanyCount(
        [
          co(),
          co({ deleted_at: '2026-01-01' }),
          co({ created_by: 'boss' }), // employee or manager there: free and unlimited
          co({ type: 'trip' }),
          co({ created_by: null, pending: true }), // made on this phone, not synced yet
        ],
        'me',
      ),
    ).toBe(2);
  });
  it('is zero when signed out', () => {
    expect(ownedCompanyCount([co()], null)).toBe(0);
  });
});

describe('createGate', () => {
  it('first company is free, an extra one needs a slot unless one is free', () => {
    expect(createGate({ needs_slot: false, has_free_slot: false }, 0)).toBe('create');
    expect(createGate({ needs_slot: true, has_free_slot: false }, 1)).toBe('paywall');
    expect(createGate({ needs_slot: true, has_free_slot: true }, 1)).toBe('create');
  });
  it('offline falls back to the local count', () => {
    expect(createGate(null, 0)).toBe('create');
    expect(createGate(null, 1)).toBe('paywall');
  });
});

describe('isSlotRequired', () => {
  it('reads the server code from a string or an error', () => {
    expect(isSlotRequired('COMPANY_SLOT_REQUIRED: an extra company needs a subscription')).toBe(
      true,
    );
    expect(isSlotRequired(new Error('COMPANY_SLOT_REQUIRED: x'))).toBe(true);
    expect(isSlotRequired(new Error('other'))).toBe(false);
    expect(isSlotRequired(null)).toBe(false);
  });
});
