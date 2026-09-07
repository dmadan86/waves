import { describe, expect, it } from 'vitest';

import {
  inclusiveTripDays,
  tripDateFromIso,
  tripDateRangePatch,
  tripDateToIso,
} from '../src/lib/tripDateRange';

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
