/**
 * The callback carrying an authorization code can reach the app twice, and the
 * code can only be spent once. This is the rule that decides which arrival
 * spends it — see `src/lib/oauthClaim.ts` for why both arrivals exist.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { claimCode, resetClaimedCodes } from '../src/lib/oauthClaim';

describe('claiming an authorization code', () => {
  beforeEach(() => {
    resetClaimedCodes();
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
});
