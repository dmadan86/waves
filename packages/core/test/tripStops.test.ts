/**
 * The itinerary: which country the trip was in on which day, and what that
 * decides. The rules here are the ones `waves_set_trip_stops` re-runs in SQL,
 * so a sheet refusing an overlap and the server refusing it agree.
 */

import { describe, expect, it } from 'vitest';

import {
  currencyForStop,
  isIsoDay,
  parseTripStops,
  sortStops,
  spendByCountry,
  StopError,
  stopCurrencies,
  stopForDate,
  TRIP_STOPS_MAX,
  validateStops,
  type StopSpendExpense,
  type TripStop,
} from '../src/index';

const bali: TripStop = { country: 'ID', start: '2026-10-01', end: '2026-10-05' };
const singapore: TripStop = { country: 'SG', start: '2026-10-06', end: '2026-10-08' };
const vietnam: TripStop = { country: 'VN', start: '2026-10-09', end: '2026-10-14' };
const itinerary = [bali, singapore, vietnam];

describe('isIsoDay', () => {
  it('accepts a real calendar day and nothing else', () => {
    expect(isIsoDay('2026-10-01')).toBe(true);
    expect(isIsoDay('2024-02-29')).toBe(true);
    expect(isIsoDay('2026-02-29')).toBe(false);
    expect(isIsoDay('2026-13-01')).toBe(false);
    expect(isIsoDay('2026-10-1')).toBe(false);
    expect(isIsoDay('')).toBe(false);
    expect(isIsoDay(null)).toBe(false);
  });
});

describe('validateStops', () => {
  it('passes a clean itinerary, sorted and upper-cased', () => {
    const verdict = validateStops([vietnam, { ...bali, country: 'id' }, singapore]);
    expect(verdict).toEqual({ ok: true, stops: itinerary });
  });

  it('allows an empty itinerary', () => {
    expect(validateStops([])).toEqual({ ok: true, stops: [] });
  });

  it('refuses a country that is not two letters', () => {
    expect(validateStops([{ ...bali, country: 'IDN' }])).toEqual({
      ok: false,
      code: StopError.BadCountry,
      index: 0,
    });
  });

  it('refuses a malformed date', () => {
    expect(validateStops([bali, { ...singapore, end: '2026-10-32' }])).toEqual({
      ok: false,
      code: StopError.BadDate,
      index: 1,
    });
  });

  it('refuses an end before its start', () => {
    expect(validateStops([{ country: 'SG', start: '2026-10-08', end: '2026-10-06' }])).toEqual({
      ok: false,
      code: StopError.EndBeforeStart,
      index: 0,
    });
  });

  it('refuses two stops on the same day, naming the one handed in later', () => {
    const verdict = validateStops([
      bali,
      { country: 'SG', start: '2026-10-05', end: '2026-10-08' },
    ]);
    expect(verdict).toEqual({ ok: false, code: StopError.Overlap, index: 1 });
  });

  it('reports the overlap against the list order, not the sorted order', () => {
    const verdict = validateStops([
      vietnam,
      { country: 'SG', start: '2026-10-05', end: '2026-10-09' },
      bali,
    ]);
    // Sorted: bali (1-5), SG (5-9), vietnam (9-14). SG overlaps bali and sits at index 1.
    expect(verdict).toEqual({ ok: false, code: StopError.Overlap, index: 1 });
  });

  it('keeps every stop inside the trip dates when the trip has them', () => {
    expect(validateStops(itinerary, { start: '2026-10-01', end: '2026-10-14' })).toMatchObject({
      ok: true,
    });
    expect(validateStops(itinerary, { start: '2026-10-02', end: '2026-10-14' })).toEqual({
      ok: false,
      code: StopError.OutsideTrip,
      index: 0,
    });
    expect(validateStops(itinerary, { start: null, end: '2026-10-13' })).toEqual({
      ok: false,
      code: StopError.OutsideTrip,
      index: 2,
    });
  });

  it('caps the itinerary', () => {
    const many = Array.from({ length: TRIP_STOPS_MAX + 1 }, (_, i) => ({
      country: 'ID',
      start: `2026-01-${String(i + 1).padStart(2, '0')}`,
      end: `2026-01-${String(i + 1).padStart(2, '0')}`,
    }));
    expect(validateStops(many)).toEqual({ ok: false, code: StopError.TooMany, index: 15 });
    expect(validateStops(many.slice(0, TRIP_STOPS_MAX))).toMatchObject({ ok: true });
  });
});

describe('parseTripStops', () => {
  it('reads the stored column and drops anything malformed', () => {
    expect(
      parseTripStops([
        vietnam,
        { country: 'sg', start: '2026-10-06', end: '2026-10-08' },
        { country: 'XYZ', start: '2026-10-01', end: '2026-10-05' },
        { country: 'ID', start: '2026-10-05', end: '2026-10-01' },
        'nonsense',
        null,
      ]),
    ).toEqual([singapore, vietnam]);
    expect(parseTripStops(null)).toEqual([]);
    expect(parseTripStops({})).toEqual([]);
  });
});

describe('stopForDate and currencies', () => {
  it('finds the stop a day falls in, inclusive at both ends', () => {
    expect(stopForDate(itinerary, '2026-10-01')).toEqual(bali);
    expect(stopForDate(itinerary, '2026-10-05')).toEqual(bali);
    expect(stopForDate(itinerary, '2026-10-06')).toEqual(singapore);
    expect(stopForDate(itinerary, '2026-10-14')).toEqual(vietnam);
    expect(stopForDate(itinerary, '2026-10-15')).toBeNull();
    expect(stopForDate(itinerary, '2026-09-30')).toBeNull();
    expect(stopForDate(itinerary, null)).toBeNull();
  });

  it('names the currency of a stop, or has no opinion', () => {
    expect(currencyForStop(bali)).toBe('IDR');
    expect(currencyForStop(singapore)).toBe('SGD');
    expect(currencyForStop({ country: 'ZZ', start: '2026-10-01', end: '2026-10-02' })).toBeNull();
    expect(currencyForStop(null)).toBeNull();
  });

  it('lists the currencies the trip needs rates for, once each, without the home one', () => {
    expect(stopCurrencies(itinerary, 'INR')).toEqual(['IDR', 'SGD', 'VND']);
    expect(
      stopCurrencies(
        [...itinerary, { country: 'ID', start: '2026-10-15', end: '2026-10-16' }],
        'SGD',
      ),
    ).toEqual(['IDR', 'VND']);
    expect(stopCurrencies([], 'INR')).toEqual([]);
  });

  it('sorts by start day', () => {
    expect(sortStops([vietnam, bali, singapore])).toEqual(itinerary);
  });
});

describe('spendByCountry', () => {
  const vndRate = { from: 'VND', to: 'INR', num: '1', den: '300', ts: 't', source: 'manual' };
  const expenses: StopSpendExpense[] = [
    // Bali, in rupees already.
    {
      id: 'a',
      currentVersion: {
        currency: 'INR',
        expense_date: '2026-10-02',
        amount: '150000',
        shares: [
          { member_id: 'm1', amount: '75000' },
          { member_id: 'm2', amount: '75000' },
        ],
      },
    },
    // Vietnam, ₫300,000 (dong has no minor unit) at 300 to the rupee → ₹1,000.
    {
      id: 'b',
      currentVersion: {
        currency: 'VND',
        expense_date: '2026-10-10',
        amount: '300000',
        shares: [{ member_id: 'm1', amount: '300000' }],
        fx: vndRate,
      },
    },
    // Vietnam, no rate on the bill — the trip rate (if any) decides.
    {
      id: 'c',
      currentVersion: {
        currency: 'VND',
        expense_date: '2026-10-11',
        amount: '600000',
        shares: [{ member_id: 'm2', amount: '600000' }],
        fx: null,
      },
    },
    // A flight booked a month before: outside every stop.
    {
      id: 'd',
      currentVersion: {
        currency: 'INR',
        expense_date: '2026-09-01',
        amount: '4000000',
        shares: [{ member_id: 'm1', amount: '4000000' }],
      },
    },
    // Deleted: never counts.
    {
      id: 'e',
      deleted_at: '2026-10-03T00:00:00Z',
      currentVersion: {
        currency: 'INR',
        expense_date: '2026-10-03',
        amount: '999999',
        shares: [{ member_id: 'm1', amount: '999999' }],
      },
    },
  ];

  it('files each bill under its stop and converts at the saved rate', () => {
    const rows = spendByCountry(expenses, itinerary, 'INR');
    expect(rows.map((row) => row.stop?.country ?? 'other')).toEqual(['ID', 'SG', 'VN', 'other']);
    expect(rows[0]).toMatchObject({ totalMinor: 150000n, expenseCount: 1, unconvertedCount: 0 });
    expect(rows[1]).toMatchObject({ totalMinor: 0n, expenseCount: 0 });
    // One bill converted (₹1,000.00), one with no rate left out and named.
    expect(rows[2]).toMatchObject({
      totalMinor: 100000n,
      expenseCount: 1,
      unconverted: { VND: 600000n },
      unconvertedCount: 1,
    });
    expect(rows[3]).toMatchObject({ stop: null, totalMinor: 4000000n, expenseCount: 1 });
  });

  it('falls back to the trip rate for a bill saved without one', () => {
    const rows = spendByCountry(expenses, itinerary, 'INR', {
      tripRates: { VND: { num: '1', den: '300', ts: 't', source: 'manual' } },
    });
    expect(rows[2]).toMatchObject({ totalMinor: 300000n, expenseCount: 2, unconvertedCount: 0 });
  });

  it('narrows to one member’s shares for "Just me"', () => {
    const rows = spendByCountry(expenses, itinerary, 'INR', { memberId: 'm1' });
    expect(rows[0]).toMatchObject({ totalMinor: 75000n, expenseCount: 1 });
    expect(rows[2]).toMatchObject({ totalMinor: 100000n, expenseCount: 1, unconvertedCount: 0 });
    expect(rows[3]).toMatchObject({ totalMinor: 4000000n });
  });

  it('omits "Other dates" when nothing falls outside the stops', () => {
    const rows = spendByCountry(expenses.slice(0, 2), itinerary, 'INR');
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.stop !== null)).toBe(true);
  });

  it('is empty-safe', () => {
    expect(spendByCountry([], [], 'INR')).toEqual([]);
    expect(spendByCountry(expenses, [], 'INR')).toHaveLength(1);
    expect(spendByCountry(expenses, [], 'INR')[0]?.stop).toBeNull();
  });
});
