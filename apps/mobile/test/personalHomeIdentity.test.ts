import { describe, expect, it } from 'vitest';
import { personalHomeIdentity } from '../src/data/personalHomeIdentity';
import type { PersonalTxn } from '@waves/core';

describe('offline Personal Home identity', () => {
  it('shows cached name and INR from local entries before profile/network data arrives', () => {
    const txn: PersonalTxn = {
      id: 'local',
      kind: 'expense',
      amount: 67900n,
      currency: 'INR',
      category: null,
      note: null,
      date: '2026-11-26',
      loanId: null,
      recurringId: null,
    };
    expect(
      personalHomeIdentity(
        { display_name: 'Madan Das', default_currency: '' },
        [txn],
        [],
        'USD',
        'You',
      ),
    ).toEqual({ name: 'Madan Das', currency: 'INR' });
    expect(
      personalHomeIdentity(
        { display_name: 'Madan Das', default_currency: 'INR' },
        [txn],
        [],
        'USD',
        'You',
      ),
    ).toEqual({ name: 'Madan Das', currency: 'INR' });
    expect(personalHomeIdentity(null, [txn], [], 'USD', 'You')).toEqual({
      name: 'You',
      currency: 'INR',
    });
    expect(personalHomeIdentity(null, [], [], 'USD', 'You')).toEqual({
      name: 'You',
      currency: 'USD',
    });
  });
});

describe('offline profile cache', () => {
  it('keeps name, currency and locale but never address or payment details', async () => {
    const { toProfileCache, profileFromCache } = await import('../src/lib/profileCache');
    const full = {
      id: 'u1',
      display_name: 'Asha',
      avatar_url: 'https://x/a.png',
      default_vpa: 'asha@upi',
      payment_rail: 'upi',
      payment_handle: 'asha@upi',
      country_code: 'IN',
      address: '12 MG Road',
      default_currency: 'INR',
      locale: 'en-IN',
    };
    const stored = JSON.stringify(toProfileCache(full));
    expect(stored).not.toContain('asha@upi');
    expect(stored).not.toContain('MG Road');
    expect(profileFromCache(JSON.parse(stored))).toEqual({
      ...full,
      avatar_url: null,
      default_vpa: null,
      payment_rail: null,
      payment_handle: null,
      address: null,
    });
  });
});
