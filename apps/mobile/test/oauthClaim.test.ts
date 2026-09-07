/**
 * The callback carrying an authorization code can reach the app twice, and the
 * code can only be spent once. This is the rule that decides which arrival
 * spends it — see `src/lib/oauthClaim.ts` for why both arrivals exist.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { claimCode, resetClaimedCodes, setClaimedCodeClock } from '../src/lib/oauthClaim';

describe('claiming an authorization code', () => {
  let now: number;

  beforeEach(() => {
    resetClaimedCodes();
    now = 1_000;
    setClaimedCodeClock(() => now);
  });

  it('is granted once and refused afterwards', () => {
    expect(claimCode('abc-123')).toBe(true);
    expect(claimCode('abc-123')).toBe(false);
    expect(claimCode('abc-123')).toBe(false);
  });

  it('keeps codes apart, so a second sign-in is not refused', () => {
    expect(claimCode('first')).toBe(true);
    expect(claimCode('second')).toBe(true);
  });

  it('forgets stale codes after the replay window', () => {
    expect(claimCode('abc-123')).toBe(true);
    now += 10 * 60 * 1000;
    expect(claimCode('abc-123')).toBe(false);
    now += 1;
    expect(claimCode('abc-123')).toBe(true);
  });

  it('evicts the oldest codes when distinct callbacks flood the process', () => {
    expect(claimCode('oldest')).toBe(true);
    for (let index = 0; index < 256; index += 1) {
      expect(claimCode(`flood-${index}`)).toBe(true);
    }

    // The oldest entry was evicted to keep the registry bounded, while the most
    // recent callback remains protected against the legitimate duplicate route.
    expect(claimCode('oldest')).toBe(true);
    expect(claimCode('flood-255')).toBe(false);
  });
});
