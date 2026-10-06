import { describe, expect, it } from 'vitest';

import { fxRate, toFxRecord } from '@waves/core';

import { rateAt, rateNote, rateOrigin } from '../src/lib/fxLine';

const words = { rateToday: "today's rate", rateYours: 'your rate', rateTrip: 'trip rate' };
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
    expect(rateOrigin(record('ecb'))).toBe('today');
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
  it('fills the "at {rate}" template', () => {
    expect(rateAt(record('ecb'), 'at {rate}')).toBe('at 1 $ = ₹93');
  });
});
