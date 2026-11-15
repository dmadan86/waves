import { describe, expect, it } from 'vitest';
import { birthdayToDate, dateToBirthday, formatBirthday } from '../src/lib/birthday';

describe('birthday helpers', () => {
  it('round-trips day and month, including 29 Feb', () => {
    for (const b of [
      { day: 17, month: 11 },
      { day: 29, month: 2 },
      { day: 1, month: 1 },
    ]) {
      expect(dateToBirthday(birthdayToDate(b))).toEqual(b);
    }
  });
  it('formats without a year', () => {
    expect(formatBirthday({ day: 17, month: 11 }, 'en-GB')).toBe('17 Nov');
  });
});
