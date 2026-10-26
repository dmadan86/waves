import { describe, expect, it } from 'vitest';
import { nativeEligible, nativePositions, nativeUnitId } from '../src/lib/nativeAdsPure';
import { bannerGateOpen } from '../src/lib/bannerAdsPure';
import { parseAdsStatus } from '../src/lib/rewardedAdsPure';

describe('native ads gates', () => {
  const free = { enabled: true };
  it('requires sign-in, rollout and affirmative server gate', () => {
    expect(nativeEligible(true, true, free)).toBe(true);
    expect(nativeEligible(false, true, free)).toBe(false);
    expect(nativeEligible(true, false, free)).toBe(false);
    expect(nativeEligible(true, true, null)).toBe(false);
    expect(nativeEligible(true, true, undefined)).toBe(false);
    expect(nativeEligible(true, true, { enabled: false })).toBe(false);
    expect(nativeEligible(true, true, {})).toBe(false);
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
    expect(nativeEligible(true, true, gate)).toBe(true);
    expect(bannerGateOpen(gate)).toBe(true);
  });
  it('places the first ad after five items with seeded gaps of fifteen to twenty', () => {
    const positions = nativePositions(300, 'activity');
    expect(positions[0]).toBe(5);
    expect(positions.length).toBeGreaterThan(10);
    positions.slice(1).forEach((position, index) => {
      const gap = position - positions[index]!;
      expect(Number.isInteger(gap)).toBe(true);
      expect(gap).toBeGreaterThanOrEqual(15);
      expect(gap).toBeLessThanOrEqual(20);
    });
  });
  it('repeats the same seed and varies across seeds', () => {
    expect(nativePositions(300, 'activity')).toEqual(nativePositions(300, 'activity'));
    const results = ['activity', 'friends', 'another-list'].map((seed) =>
      JSON.stringify(nativePositions(300, seed)),
    );
    expect(new Set(results).size).toBeGreaterThan(1);
  });
  it('preserves positions as the list grows', () => {
    for (const seed of ['activity', 'friends', 'another-list']) {
      const short = nativePositions(100, seed);
      const long = nativePositions(300, seed);
      expect(short).toEqual(long.filter((position) => position < 100));
      expect(long.slice(0, short.length)).toEqual(short);
    }
  });
  it('requires eight items and never places an ad at or after the end', () => {
    for (const count of [-1, 0, 1, 5, 7, NaN, Infinity]) {
      expect(nativePositions(count, 'activity')).toEqual([]);
    }
    expect(nativePositions(8, 'activity')).toEqual([5]);
    for (let count = 8; count <= 300; count++) {
      for (const position of nativePositions(count, 'activity')) {
        expect(position).toBeLessThan(count);
      }
    }
  });
  it('uses platform test ids in development or when unconfigured', () => {
    expect(nativeUnitId('ios', 'real', true)).toContain('3986624511');
    expect(nativeUnitId('android', undefined, false)).toContain('2247696110');
    expect(nativeUnitId('ios', ' real ', false)).toBe('real');
  });
});
