import { describe, expect, it } from 'vitest';

import {
  heroForPickedScene,
  hemisphereForRegion,
  msUntilNextBoundary,
  seasonFor,
  selectHomeHero,
  slotFor,
} from '../src/lib/homeHeroPure';

const at = (h: number, m = 0, month = 5) => new Date(2026, month, 15, h, m);

describe('slotFor boundaries', () => {
  it.each([
    [4, 59, 'night'],
    [5, 0, 'morning'],
    [8, 59, 'morning'],
    [9, 0, 'late-morning'],
    [11, 59, 'late-morning'],
    [12, 0, 'afternoon'],
    [15, 59, 'afternoon'],
    [16, 0, 'evening'],
    [17, 59, 'evening'],
    [18, 0, 'sunset'],
    [19, 59, 'sunset'],
    [20, 0, 'night'],
    [23, 59, 'night'],
    [0, 0, 'night'],
  ])('%i:%i is %s', (h, m, expected) => {
    expect(slotFor(at(h, m))).toBe(expected);
  });
});

describe('selectHomeHero', () => {
  it('follows the clock with no context', () => {
    expect(selectHomeHero(at(10, 0, 2))).toBe('late-morning');
    expect(selectHomeHero(at(14, 0, 9))).toBe('afternoon');
  });

  it('never picks rainy by itself', () => {
    for (let h = 0; h < 24; h++) expect(selectHomeHero(at(h))).not.toBe('rainy');
  });

  it('wears rainy only when asked, and only by day', () => {
    expect(selectHomeHero(at(7), { weather: 'rainy' })).toBe('rainy');
    expect(selectHomeHero(at(10), { weather: 'rainy' })).toBe('rainy');
    expect(selectHomeHero(at(13), { weather: 'rainy' })).toBe('rainy');
    expect(selectHomeHero(at(17), { weather: 'rainy' })).toBe('evening');
    expect(selectHomeHero(at(22), { weather: 'rainy' })).toBe('night');
  });

  it('rainy beats a season', () => {
    expect(selectHomeHero(at(13, 0, 2), { regionCode: 'GB', weather: 'rainy' })).toBe('rainy');
  });

  it('northern spring and autumn, daytime slots only', () => {
    expect(selectHomeHero(at(10, 0, 2), { regionCode: 'GB' })).toBe('spring');
    expect(selectHomeHero(at(13, 0, 3), { regionCode: 'US' })).toBe('spring');
    expect(selectHomeHero(at(13, 0, 9), { regionCode: 'US' })).toBe('autumn');
    expect(selectHomeHero(at(10, 0, 10), { regionCode: 'gb' })).toBe('autumn');
    expect(selectHomeHero(at(7, 0, 2), { regionCode: 'GB' })).toBe('morning');
    expect(selectHomeHero(at(17, 0, 9), { regionCode: 'GB' })).toBe('evening');
    expect(selectHomeHero(at(19, 0, 9), { regionCode: 'GB' })).toBe('sunset');
    expect(selectHomeHero(at(22, 0, 3), { regionCode: 'GB' })).toBe('night');
  });

  it('swaps seasons in the southern hemisphere', () => {
    expect(selectHomeHero(at(13, 0, 2), { regionCode: 'AU' })).toBe('autumn');
    expect(selectHomeHero(at(13, 0, 9), { regionCode: 'AU' })).toBe('spring');
  });

  it('has no season outside Mar-Apr / Oct-Nov', () => {
    for (const month of [0, 1, 4, 5, 6, 7, 8, 11]) {
      expect(selectHomeHero(at(13, 0, month), { regionCode: 'GB' })).toBe('afternoon');
    }
  });

  it('falls back to time of day for unknown or tropical regions', () => {
    expect(selectHomeHero(at(13, 0, 2), { regionCode: 'IN' })).toBe('afternoon');
    expect(selectHomeHero(at(13, 0, 2), { regionCode: 'AE' })).toBe('afternoon');
    expect(selectHomeHero(at(13, 0, 2), { regionCode: null })).toBe('afternoon');
    expect(selectHomeHero(at(13, 0, 2), { regionCode: '' })).toBe('afternoon');
    expect(selectHomeHero(at(13, 0, 2), { regionCode: 'ZZ' })).toBe('afternoon');
  });
});

describe('hemisphere and season helpers', () => {
  it('maps regions', () => {
    expect(hemisphereForRegion('US')).toBe('north');
    expect(hemisphereForRegion('NZ')).toBe('south');
    expect(hemisphereForRegion(undefined)).toBeNull();
    expect(hemisphereForRegion('IN')).toBeNull();
  });
  it('seasonFor', () => {
    expect(seasonFor(2, 'north')).toBe('spring');
    expect(seasonFor(2, 'south')).toBe('autumn');
    expect(seasonFor(6, 'north')).toBeNull();
  });
});

describe('msUntilNextBoundary', () => {
  it('counts to the next slot change', () => {
    expect(msUntilNextBoundary(at(8, 30))).toBe(30 * 60 * 1000);
    expect(msUntilNextBoundary(at(9, 0))).toBe(3 * 3600 * 1000);
    expect(msUntilNextBoundary(at(21, 0))).toBe(8 * 3600 * 1000);
    expect(msUntilNextBoundary(at(2, 0))).toBe(3 * 3600 * 1000);
  });
});

describe('heroForPickedScene', () => {
  it('maps picker scenes, winter and null to the clock', () => {
    expect(heroForPickedScene('sunset')).toBe('sunset');
    expect(heroForPickedScene('winter')).toBeNull();
    expect(heroForPickedScene(null)).toBeNull();
  });
});
