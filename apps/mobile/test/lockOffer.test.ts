import { describe, expect, it } from 'vitest';

import { lockOfferKey, shouldOfferLock } from '../src/lib/lockOfferPure';

const base = { groupType: 'couple', lockEnabled: false, lockSupported: true, alreadyShown: false };

describe('shouldOfferLock', () => {
  it('offers for couple and home groups', () => {
    expect(shouldOfferLock(base)).toBe(true);
    expect(shouldOfferLock({ ...base, groupType: 'home' })).toBe(true);
  });
  it('does not offer for other groups', () => {
    expect(shouldOfferLock({ ...base, groupType: 'trip' })).toBe(false);
  });
  it('skips when the lock is on, unsupported or already offered', () => {
    expect(shouldOfferLock({ ...base, lockEnabled: true })).toBe(false);
    expect(shouldOfferLock({ ...base, lockSupported: false })).toBe(false);
    expect(shouldOfferLock({ ...base, alreadyShown: true })).toBe(false);
  });
  it('keys the memory per account', () => {
    expect(lockOfferKey('a')).not.toBe(lockOfferKey('b'));
  });
});
