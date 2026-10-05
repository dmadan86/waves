import { describe, expect, it } from 'vitest';

import {
  formatShortDateRange,
  inclusiveTripDays,
  tripDateFromIso,
  tripDateRangePatch,
  tripDateToIso,
  savesFirstTap,
} from '../src/lib/tripDateRange';

describe('reading a stored trip day', () => {
  it('reads no day, or a malformed one, as no date rather than an invalid one', () => {
    expect(tripDateFromIso(null)).toBeNull();
    expect(tripDateFromIso('')).toBeNull();
    expect(tripDateFromIso('2026-10')).toBeNull();
    expect(tripDateFromIso('not-a-day')).toBeNull();
  });

  it('reads a stored day as local noon on that day', () => {
    const date = tripDateFromIso('2026-10-04');
    expect([date?.getFullYear(), date?.getMonth(), date?.getDate(), date?.getHours()]).toEqual([
      2026, 9, 4, 12,
    ]);
  });
});

describe('trip date range helpers', () => {
  it('stores the earlier tapped day first, so traveller return-before-departure taps still save a valid range', () => {
    const patch = tripDateRangePatch(
      new Date(2026, 9, 11, 12),
      new Date(2026, 9, 4, 12),
      'Asia/Dubai',
    );

    expect(patch).toEqual({
      start_date: '2026-10-04',
      end_date: '2026-10-11',
      time_zone: 'Asia/Dubai',
    });
  });

  it('allows a one-day trip for a rider or user who taps the same day twice', () => {
    const day = new Date(2026, 9, 4, 12);

    expect(tripDateRangePatch(day, day, 'Asia/Kolkata')).toEqual({
      start_date: '2026-10-04',
      end_date: '2026-10-04',
      time_zone: 'Asia/Kolkata',
    });
    expect(inclusiveTripDays(day, day)).toBe(1);
  });

  it('counts both endpoints for financer budget pacing across the trip', () => {
    expect(inclusiveTripDays(new Date(2026, 9, 4, 12), new Date(2026, 9, 11, 12))).toBe(8);
  });

  it('serializes the local calendar day instead of leaking through UTC', () => {
    const lateEvening = new Date(2026, 9, 4, 23, 30);
    expect(tripDateToIso(lateEvening)).toBe('2026-10-04');
  });

  it('ignores incomplete or malformed stored dates', () => {
    expect(tripDateFromIso(null)).toBeNull();
    expect(tripDateFromIso('2026-10')).toBeNull();
    expect(tripDateFromIso('not-a-date')).toBeNull();
  });
});

describe('savesFirstTap', () => {
  it('saves the first tap while the trip has no dates', () => {
    expect(savesFirstTap(null, null)).toBe(true);
    expect(savesFirstTap('2026-09-17', null)).toBe(true);
  });

  it('saves it over a one-day trip, which it only replaces', () => {
    expect(savesFirstTap('2026-09-08', '2026-09-08')).toBe(true);
  });

  it('holds it as a draft over a real range, which leaving must keep', () => {
    expect(savesFirstTap('2026-09-08', '2026-09-12')).toBe(false);
  });
});

describe('formatShortDateRange', () => {
  it('collapses a same-month range', () => {
    expect(formatShortDateRange('2026-12-12', '2026-12-15', 'en-GB')).toBe('12–15 Dec');
  });
  it('spells both months across a month boundary', () => {
    expect(formatShortDateRange('2026-11-28', '2026-12-02', 'en-GB')).toBe('28 Nov – 2 Dec');
  });
  it('adds the year across years, and reads one day as one date', () => {
    expect(formatShortDateRange('2026-12-30', '2027-01-02', 'en-GB')).toBe(
      '30 Dec 2026 – 2 Jan 2027',
    );
    expect(formatShortDateRange('2026-12-12', '2026-12-12', 'en-GB')).toBe('12 Dec');
  });
  it('is null without both ends', () => {
    expect(formatShortDateRange(null, '2026-12-12', 'en-GB')).toBeNull();
    expect(formatShortDateRange('2026-12-12', undefined, 'en-GB')).toBeNull();
  });
});
