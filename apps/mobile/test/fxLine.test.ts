import { describe, expect, it } from 'vitest';

import { fxRate, toFxRecord } from '@waves/core';

import {
  minorToPlain,
  rateAt,
  rateNote,
  rateOrigin,
  rateParts,
  updatedAgo,
} from '../src/lib/fxLine';

const words = {
  rateMarket: 'market rate · {date}',
  rateToday: "today's rate",
  rateYours: 'your rate',
  rateTrip: 'trip rate',
};
const record = (source: string) =>
  toFxRecord(
    fxRate({
      num: 9300n,
      den: 100n,
      from: 'USD',
      to: 'INR',
      ts: '2026-01-01T00:00:00.000Z',
      source,
    }),
  );

describe('rateOrigin', () => {
  it('calls a fetched rate today’s, a typed or implied one yours, a pinned one the trip’s', () => {
    expect(rateOrigin(record('ecb'), false, Date.parse('2026-01-01T12:00:00.000Z'))).toBe('today');
    expect(rateOrigin(record('ecb'), false, Date.parse('2026-01-04T12:00:00.000Z'))).toBe('market');
    expect(rateOrigin(record('manual'))).toBe('yours');
    expect(rateOrigin(record('implied'))).toBe('yours');
    expect(rateOrigin(record('ecb'), true)).toBe('trip');
  });
});

describe('rateNote / rateAt', () => {
  it('writes the rate and where it came from on one line', () => {
    expect(rateNote(record('ecb'), 'today', words)).toBe("1 $ = ₹93 · today's rate");
    expect(rateNote(record('manual'), 'yours', words)).toBe('1 $ = ₹93 · your rate');
  });
  it('dates an older market rate', () => {
    expect(rateNote(record('ecb'), 'market', words, 'en-US')).toBe(
      '1 $ = ₹93 · market rate · Jan 1',
    );
  });
  it('fills the "at {rate}" template', () => {
    expect(rateAt(record('ecb'), 'at {rate}')).toBe('at 1 $ = ₹93');
  });
});

describe('sheet helpers', () => {
  it('writes minor units as plain digits', () => {
    expect(minorToPlain(624300n, 'INR')).toBe('6243.00');
    expect(minorToPlain(5n, 'INR')).toBe('0.05');
    expect(minorToPlain(1500n, 'JPY')).toBe('1500');
  });
  it('splits the big rate line', () => {
    expect(rateParts(record('ecb'))).toEqual({ left: '1 USD =', right: '93.00 INR' });
  });
  it('says how long ago the rate was fetched', () => {
    const w = {
      sheetUpdatedNow: 'now',
      sheetUpdatedMin: '{n} min',
      sheetUpdatedHour: '{n} h',
      sheetUpdatedDay: '{n} d',
    };
    const t0 = Date.parse('2026-01-01T00:00:00.000Z');
    expect(updatedAgo('2026-01-01T00:00:00.000Z', t0 + 20_000, w)).toBe('now');
    expect(updatedAgo('2026-01-01T00:00:00.000Z', t0 + 120_000, w)).toBe('2 min');
    expect(updatedAgo('2026-01-01T00:00:00.000Z', t0 + 3 * 3600_000, w)).toBe('3 h');
    expect(updatedAgo('2026-01-01T00:00:00.000Z', t0 + 2 * 86400_000, w)).toBe('2 d');
    expect(updatedAgo('nope', t0, w)).toBeNull();
  });
});
