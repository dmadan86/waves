/**
 * The three conversions of an expense's day. The trap they exist to avoid: a
 * `YYYY-MM-DD` read as midnight UTC is the previous day west of Greenwich.
 */

import { describe, expect, it } from 'vitest';

import { dateFrom, isoDate, showDate } from '../src/lib/expenseDay';

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
