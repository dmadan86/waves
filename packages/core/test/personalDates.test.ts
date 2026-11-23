import { describe, expect, it } from 'vitest';

import {
  allOccurrences,
  defaultFestivals,
  FESTIVAL_DATES,
  nextOccurrence,
  nextFestival,
  upcomingDates,
} from '../src/personal/dates';
import { dayDelta } from '../src/personal/compute';
import { decodeDate, encodeDate, type PersonalDate } from '../src/personal/types';

const d = (over: Partial<PersonalDate>): PersonalDate => ({
  id: 'a',
  label: 'family_birthday',
  name: 'Asha',
  day: 1,
  month: 1,
  year: null,
  ...over,
});

describe('date codec', () => {
  it('round-trips and carries unknown fields', () => {
    const blob = { label: 'anniversary', name: '', day: 3, month: 4, year: null, future: 'x' };
    const rec = decodeDate('id', blob);
    expect(rec.carried).toEqual({ future: 'x' });
    expect(encodeDate(rec)).toEqual(blob);
  });
  it('degrades garbage safely', () => {
    const rec = decodeDate('id', { label: 'zzz', day: 99, month: 40, year: 'x' });
    expect(rec).toMatchObject({ label: 'other', day: 1, month: 1, year: null });
  });
});

describe('nextOccurrence', () => {
  it('is today when today is the day', () => {
    expect(nextOccurrence(21, 11, '2026-11-21')).toEqual({ date: '2026-11-21', inDays: 0 });
  });
  it('wraps the year', () => {
    expect(nextOccurrence(2, 1, '2026-12-30')).toEqual({ date: '2027-01-02', inDays: 3 });
  });
  it('keeps 29 Feb on 28 Feb in a non-leap year and 29 in a leap year', () => {
    expect(nextOccurrence(29, 2, '2026-12-01').date).toBe('2027-02-28');
    expect(nextOccurrence(29, 2, '2027-12-01').date).toBe('2028-02-29');
  });
  it('counts days across a DST change on local dates', () => {
    expect(dayDelta('2026-03-28', '2026-03-30')).toBe(2);
    expect(dayDelta('2026-10-30', '2026-11-02')).toBe(3);
  });
});

describe('festivals and upcoming', () => {
  it('defaults by country', () => {
    expect(defaultFestivals('IN')).toContain('pongal');
    expect(defaultFestivals('US')).toContain('thanksgiving');
    expect(defaultFestivals('GB')).not.toContain('thanksgiving');
    expect(defaultFestivals(null)).toContain('christmas');
    expect(defaultFestivals(null)).toEqual(['christmas', 'mothers_day', 'fathers_day']);
    expect(defaultFestivals('AE')).toEqual([
      'eid_al_fitr',
      'eid_al_adha',
      'ramadan_start',
      'national_day',
      'diwali',
      'christmas',
    ]);
    expect(defaultFestivals('UK')).toContain('mothers_day');
    expect(defaultFestivals('AU')).toContain('lunar_new_year');
    expect(defaultFestivals('US')).toContain('hanukkah');
  });
  it('keeps at least twelve months of moving festival dates from fixed now and stays capped at 2030', () => {
    const tabulated = Object.values(FESTIVAL_DATES).flat();
    expect(Math.max(...tabulated.map((date) => Number(date.slice(0, 4))))).toBe(2030);
    expect((tabulated.sort().at(-1) ?? '') >= '2027-11-21').toBe(true);
    expect(FESTIVAL_DATES.lunar_new_year).toContain('2030-02-03');
  });
  it('computes the country-specific Mother and Father days', () => {
    expect(nextFestival('easter', '2026-01-01')?.date).toBe('2026-04-05');
    expect(nextFestival('mothers_day', '2026-01-01', 'US')?.date).toBe('2026-05-10');
    expect(nextFestival('mothers_day', '2026-01-01', 'GB')?.date).toBe('2026-03-15');
    expect(nextFestival('fathers_day', '2026-01-01', 'AU')?.date).toBe('2026-09-06');
    expect(nextFestival('fathers_day', '2026-01-01', 'US')?.date).toBe('2026-06-21');
  });
  it('limits to 3, 30 days (festivals 21) and honours switched-off festivals', () => {
    const dates = [
      d({ id: '1', day: 25, month: 11 }),
      d({ id: '2', day: 28, month: 11 }),
      d({ id: '3', day: 1, month: 12 }),
      d({ id: '4', day: 15, month: 12 }),
    ];
    const items = upcomingDates({ dates, country: 'GB', festivalsOff: [], todayIso: '2026-11-21' });
    expect(items.map((i) => i.id)).toEqual(['1', '2', '3']);
    // Christmas is 34 days out: outside the 21-day festival window.
    expect(items.some((i) => i.id === 'christmas')).toBe(false);
    const dec = upcomingDates({
      dates: [],
      country: 'GB',
      festivalsOff: [],
      todayIso: '2026-12-10',
    });
    expect(dec.map((i) => i.id)).toEqual(['christmas']);
    expect(
      upcomingDates({
        dates: [],
        country: 'GB',
        festivalsOff: ['christmas'],
        todayIso: '2026-12-10',
      }),
    ).toEqual([]);
  });
  it('counts work-anniversary years', () => {
    const [i] = allOccurrences({
      dates: [d({ label: 'work_anniversary', year: 2020, day: 5, month: 1 })],
      country: 'GB',
      festivalsOff: ['christmas', 'eid_al_fitr', 'eid_al_adha', 'diwali', 'easter'],
      todayIso: '2026-12-30',
    });
    expect(i!.years).toBe(7);
  });
});
