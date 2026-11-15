import { describe, expect, it } from 'vitest';
import { nativeEligible, nativeUnitId, nativeCapacityAvailable } from '../src/lib/nativeAdsPure';
import { bannerGateOpen } from '../src/lib/bannerAdsPure';
import { parseAdsStatus } from '../src/lib/rewardedAdsPure';

describe('native ads gates', () => {
  const free = { enabled: true };
  it('requires sign-in, rollout and affirmative server gate', () => {
    expect(nativeEligible(true, true, free, 0)).toBe(true);
    expect(nativeEligible(false, true, free, 0)).toBe(false);
    expect(nativeEligible(true, false, free, 0)).toBe(false);
    expect(nativeEligible(true, true, null, 0)).toBe(false);
    expect(nativeEligible(true, true, undefined, 0)).toBe(false);
    expect(nativeEligible(true, true, { enabled: false }, 0)).toBe(false);
    expect(nativeEligible(true, true, {}, 0)).toBe(false);
  });
  it('keeps native and banner ads eligible after the rewarded daily cap', () => {
    const rewarded = parseAdsStatus({
      eligible: false,
      reason: 'capped',
      dailyCap: 3,
      usedToday: 3,
    });
    const gate = { enabled: true, bannerEligible: true };
    expect(rewarded.eligible).toBe(false);
    expect(nativeEligible(true, true, gate, 0)).toBe(true);
    expect(bannerGateOpen(gate)).toBe(true);
  });
  it('defaults to unlimited for null or missing caps', () => {
    for (const gate of [
      free,
      { ...free, nativeDailyCap: null },
      { ...free, settings: { native_daily_cap: null } },
    ]) {
      expect(nativeEligible(true, true, gate, 100)).toBe(true);
    }
  });
  it('uses the server cap and fails closed for invalid counters', () => {
    for (const gate of [
      { ...free, nativeDailyCap: 2 },
      { ...free, settings: { native_daily_cap: 2 } },
    ]) {
      expect(nativeEligible(true, true, gate, 1)).toBe(true);
      expect(nativeEligible(true, true, gate, 2)).toBe(false);
    }
    expect(nativeEligible(true, true, { ...free, nativeDailyCap: 0 }, 0)).toBe(false);
    for (const count of [-1, NaN, Infinity, 0.5]) {
      expect(nativeEligible(true, true, free, count)).toBe(false);
    }
  });
  it('uses platform test ids in development or when unconfigured', () => {
    expect(nativeUnitId('ios', 'real', true)).toContain('3986624511');
    expect(nativeUnitId('android', undefined, false)).toContain('2247696110');
    expect(nativeUnitId('ios', ' real ', false)).toBe('real');
  });
});

describe('native impression capacity', () => {
  it('holds capacity for pending ads without counting them as impressions', () => {
    expect(nativeCapacityAvailable(0, 3, 3)).toBe(false);
    expect(nativeCapacityAvailable(0, 2, 3)).toBe(true);
    expect(nativeCapacityAvailable(2, 1, 3)).toBe(false);
    expect(nativeCapacityAvailable(2, 0, 3)).toBe(true);
    expect(nativeCapacityAvailable(3, 0, 3)).toBe(false);
  });
  it('supports unlimited capacity and reserves against a configured cap', () => {
    expect(nativeCapacityAvailable(100, 100, null)).toBe(true);
    expect(nativeCapacityAvailable(100, 100)).toBe(true);
    expect(nativeCapacityAvailable(1, 1, 2)).toBe(false);
    expect(nativeCapacityAvailable(2, 0, 2)).toBe(false);
    expect(nativeCapacityAvailable(0, 0, 0)).toBe(false);
  });
  it('fails closed on invalid persisted or pending counts', () => {
    for (const invalid of [-1, NaN, Infinity, 0.5]) {
      expect(nativeCapacityAvailable(invalid, 0)).toBe(false);
      expect(nativeCapacityAvailable(0, invalid)).toBe(false);
    }
  });
});
