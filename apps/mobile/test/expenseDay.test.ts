/**
 * The three conversions of an expense's day. The trap they exist to avoid: a
 * `YYYY-MM-DD` read as midnight UTC is the previous day west of Greenwich.
 */

import { describe, expect, it } from 'vitest';

import {
  afterDateDialog,
  afterTimeDialog,
  dateFrom,
  isoDate,
  mergeDateAndTime,
  moveTimeToDay,
  pickerTime,
  showDate,
} from '../src/lib/expenseDay';

describe('the day an expense is filed under', () => {
  it('reads a stored day as local noon on that same calendar day', () => {
    const date = dateFrom('2026-09-09');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([
      2026, 8, 9, 12,
    ]);
  });

  it('round-trips through the picker without drifting a day', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2024-02-29', '2026-12-31']) {
      expect(isoDate(dateFrom(iso))).toBe(iso);
    }
  });

  it('pads single-digit months and days back to the stored shape', () => {
    expect(isoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('falls back to the first of January for parts a malformed day lacks', () => {
    const date = dateFrom('2025');
    expect(isoDate(date)).toBe('2025-01-01');
  });

  it('says the day in the reader language with weekday, day and month', () => {
    const shown = showDate('2026-09-08', 'en-GB');
    expect(shown).toMatch(/Tue/);
    expect(shown).toMatch(/8/);
    expect(shown).toMatch(/Sep/);
  });
});

describe('mergeDateAndTime', () => {
  it('puts the picked clock time on the chosen day, in local components', () => {
    const merged = mergeDateAndTime('2026-09-14', new Date(2030, 0, 1, 19, 42, 31));
    expect([merged.getFullYear(), merged.getMonth(), merged.getDate()]).toEqual([2026, 8, 14]);
    expect([merged.getHours(), merged.getMinutes(), merged.getSeconds()]).toEqual([19, 42, 0]);
  });

  it('does not slip a day for a time near midnight', () => {
    for (const [h, m] of [
      [0, 0],
      [0, 5],
      [23, 59],
    ] as const) {
      const merged = mergeDateAndTime('2026-01-31', new Date(2026, 5, 1, h, m));
      expect(isoDate(merged)).toBe('2026-01-31');
      expect([merged.getHours(), merged.getMinutes()]).toEqual([h, m]);
    }
  });

  it('survives a round trip through the stored ISO instant', () => {
    const merged = mergeDateAndTime('2026-03-01', new Date(2026, 0, 1, 8, 30));
    const back = new Date(merged.toISOString());
    expect(isoDate(back)).toBe('2026-03-01');
    expect([back.getHours(), back.getMinutes()]).toEqual([8, 30]);
  });
});

describe('moveTimeToDay', () => {
  const chosen = new Date(2026, 8, 14, 20, 15).toISOString();

  it('keeps the clock time when the day changes', () => {
    const moved = moveTimeToDay(chosen, '2026-09-20');
    const date = new Date(moved as string);
    expect(isoDate(date)).toBe('2026-09-20');
    expect([date.getHours(), date.getMinutes()]).toEqual([20, 15]);
  });

  it('returns an instant already on that day untouched', () => {
    expect(moveTimeToDay(chosen, '2026-09-14')).toBe(chosen);
  });

  it('has nothing to move when no time was chosen', () => {
    expect(moveTimeToDay(null, '2026-09-20')).toBeNull();
    expect(moveTimeToDay('garbage', '2026-09-20')).toBeNull();
  });
});

describe('pickerTime', () => {
  it('opens on the shown time', () => {
    const shown = new Date(2026, 8, 14, 19, 42).getTime();
    expect(pickerTime(shown, 0).getTime()).toBe(shown);
  });

  it('opens on now rounded to five minutes when nothing is shown', () => {
    const now = new Date(2026, 8, 14, 10, 7, 40).getTime();
    expect(pickerTime(null, now).getMinutes() % 5).toBe(0);
    expect(Math.abs(pickerTime(null, now).getTime() - now)).toBeLessThanOrEqual(150_000);
  });
});

describe('android date/time dialog chain', () => {
  it('goes on to the time dialog only after OK on the date dialog', () => {
    expect(afterDateDialog('set')).toBe('time');
    expect(afterDateDialog('dismissed')).toBe('stop');
  });

  it('keeps the time as it was when the time dialog is cancelled', () => {
    expect(afterTimeDialog('set')).toBe('set');
    expect(afterTimeDialog('dismissed')).toBe('keep');
  });
});
