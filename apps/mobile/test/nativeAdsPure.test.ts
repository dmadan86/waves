import { describe, expect, it } from 'vitest';
import {
  nativeEligible,
  nativePositions,
  nativeUnitId,
  nativeCapacityAvailable,
} from '../src/lib/nativeAdsPure';
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

describe('native impression capacity', () => {
  it('holds capacity for pending ads without counting them as impressions', () => {
    expect(nativeCapacityAvailable(0, 3)).toBe(false);
    expect(nativeCapacityAvailable(0, 2)).toBe(true);
    expect(nativeCapacityAvailable(2, 1)).toBe(false);
    expect(nativeCapacityAvailable(2, 0)).toBe(true);
    expect(nativeCapacityAvailable(3, 0)).toBe(false);
  });
  it('fails closed on invalid persisted or pending counts', () => {
    for (const invalid of [-1, NaN, Infinity, 0.5]) {
      expect(nativeCapacityAvailable(invalid, 0)).toBe(false);
      expect(nativeCapacityAvailable(0, invalid)).toBe(false);
    }
  });
});
