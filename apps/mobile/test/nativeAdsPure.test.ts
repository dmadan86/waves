import { describe, expect, it } from 'vitest';
import { nativeEligible, nativePosition, nativeUnitId } from '../src/lib/nativeAdsPure';
import { parseAdsStatus } from '../src/lib/rewardedAdsPure';

describe('native ads gates', () => {
  const free = parseAdsStatus({ eligible: true });
  it('requires sign-in, rollout and affirmative server eligibility', () => {
    expect(nativeEligible(true, true, free, 0)).toBe(true);
    expect(nativeEligible(false, true, free, 0)).toBe(false);
    expect(nativeEligible(true, false, free, 0)).toBe(false);
    expect(nativeEligible(true, true, null, 0)).toBe(false);
    for (const reason of ['paid', 'trial', 'guest', 'too_new', 'disabled', 'capped']) {
      expect(nativeEligible(true, true, parseAdsStatus({ eligible: false, reason }), 0)).toBe(
        false,
      );
    }
  });
  it('stops at three per UTC day and fails closed for invalid counters', () => {
    expect(nativeEligible(true, true, free, 2)).toBe(true);
    for (const count of [3, 4, -1, NaN, 0.5]) {
      expect(nativeEligible(true, true, free, count)).toBe(false);
    }
  });
  it('places one card after eight real rows only in long lists', () => {
    for (const count of [0, 1, 7, 8]) expect(nativePosition(count)).toBeNull();
    for (const count of [9, 20, 100]) expect(nativePosition(count)).toBe(8);
  });
  it('uses platform test ids in development or when unconfigured', () => {
    expect(nativeUnitId('ios', 'real', true)).toContain('3986624511');
    expect(nativeUnitId('android', undefined, false)).toContain('2247696110');
    expect(nativeUnitId('ios', ' real ', false)).toBe('real');
  });
});
