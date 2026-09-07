/**
 * The month grid's arithmetic and localisation.
 *
 * These are the parts of the range calendar nobody can check by looking at a
 * screenshot: whether an Arabic reader's week opens on Saturday, whether the
 * lead blanks put the first of the month under the right column once it does,
 * and whether a date-only string survives a round trip in a time zone west of
 * Greenwich. Each of those has a wrong answer that looks perfectly plausible.
 */

import { describe, expect, it } from 'vitest';

import {
  addMonths,
  dayAt,
  dayDiff,
  firstOfMonth,
  firstWeekday,
  gregorianFormatter,
  monthGrid,
  sameDay,
  startOfDay,
} from '@/lib/calendarGrid';

describe('firstWeekday', () => {
  it('opens the week on Saturday where the Arab world still does', () => {
    for (const locale of ['ar-EG', 'ar-QA', 'ar-JO', 'ar-IQ']) {
      expect(firstWeekday(locale)).toBe(6);
    }
  });

  it('follows the Gulf states that have since moved their week', () => {
    // Both of these were Saturday within living memory and are cited as
    // Saturday all over the internet. Saudi Arabia's week now opens on Sunday
    // and the UAE's on Monday, and the language is no guide to either — an
    // Arabic reader in Dubai and one in Cairo want different grids.
    expect(firstWeekday('ar-SA')).toBe(0);
    expect(firstWeekday('ar-AE')).toBe(1);
    expect(firstWeekday('en-AE')).toBe(1);
  });

  it('opens the week on Sunday in India and the United States', () => {
    for (const locale of ['en-IN', 'hi-IN', 'ta-IN', 'en-US']) {
      expect(firstWeekday(locale)).toBe(0);
    }
  });

  it('opens the week on Monday where ISO-8601 does', () => {
    for (const locale of ['en-GB', 'de-DE', 'fr-FR']) {
      expect(firstWeekday(locale)).toBe(1);
    }
  });

  it('reads a bare language tag by where that language is read', () => {
    expect(firstWeekday('ar')).toBe(6);
    expect(firstWeekday('hi')).toBe(0);
    expect(firstWeekday('ta')).toBe(0);
  });

  it('answers from its own table when the engine carries no week info', () => {
    // This is the path real phones take. Node has the whole of CLDR behind
    // `Intl.Locale`, and the Hermes builds this app ships on have no
    // `Intl.Locale` at all — so without taking it away here, every assertion
    // above proves only that Node knows its own data.
    const engine = Intl as unknown as { Locale: unknown };
    const real = engine.Locale;
    engine.Locale = undefined;
    try {
      expect(firstWeekday('ar-EG')).toBe(6);
      expect(firstWeekday('ar-SA')).toBe(0);
      expect(firstWeekday('ar-AE')).toBe(1);
      expect(firstWeekday('en-IN')).toBe(0);
      expect(firstWeekday('en-GB')).toBe(1);
      expect(firstWeekday('dv-MV')).toBe(5);
      expect(firstWeekday('ar-u-ca-islamic')).toBe(6);
      expect(firstWeekday('en-Latn-GB')).toBe(1);
      expect(firstWeekday('ar')).toBe(6);
    } finally {
      engine.Locale = real;
    }
  });

  it('does not mistake a Unicode extension for a region', () => {
    // `ca` here names the Islamic calendar, not Canada — and Canada would be a
    // Sunday answer where the Arabic default is Saturday, so the confusion
    // would be visible on screen.
    expect(firstWeekday('ar-u-ca-islamic')).toBe(6);
  });

  it('reads the region past a script subtag', () => {
    expect(firstWeekday('ar-Arab-EG')).toBe(6);
    expect(firstWeekday('en-Latn-GB')).toBe(1);
  });
});

describe('monthGrid', () => {
  it('pads the lead so the first of the month lands under its own weekday', () => {
    // October 2026 opens on a Thursday.
    const october = dayAt(2026, 9, 1);
    expect(october.getDay()).toBe(4);

    const sundayFirst = monthGrid(october, 0);
    expect(sundayFirst[0]?.slice(0, 4).every((cell) => cell === null)).toBe(true);
    expect(sundayFirst[0]?.[4]?.getDate()).toBe(1);

    // Starting the week on Saturday moves the first of the month one column on,
    // because Saturday and Sunday now precede it instead of just Sunday.
    const saturdayFirst = monthGrid(october, 6);
    expect(saturdayFirst[0]?.[5]?.getDate()).toBe(1);

    // Starting on Monday moves it back the other way.
    const mondayFirst = monthGrid(october, 1);
    expect(mondayFirst[0]?.[3]?.getDate()).toBe(1);
  });

  it('holds every day of the month and nothing from its neighbours', () => {
    const february = dayAt(2028, 1, 1); // A leap February.
    const days = monthGrid(february, 1)
      .flat()
      .filter((cell): cell is Date => cell !== null);
    expect(days).toHaveLength(29);
    expect(days[0]?.getDate()).toBe(1);
    expect(days[28]?.getDate()).toBe(29);
    expect(days.every((day) => day.getMonth() === 1)).toBe(true);
  });

  it('lays out whole weeks, however the month falls', () => {
    for (let month = 0; month < 12; month += 1) {
      for (const weekStart of [0, 1, 6]) {
        const weeks = monthGrid(dayAt(2026, month, 1), weekStart);
        expect(weeks.every((week) => week.length === 7)).toBe(true);
      }
    }
  });
});

describe('day anchors', () => {
  it('anchors at noon, so no time-zone shift can move the day', () => {
    const day = dayAt(2026, 9, 4);
    expect(day.getHours()).toBe(12);
    expect(day.getFullYear()).toBe(2026);
    expect(day.getMonth()).toBe(9);
    expect(day.getDate()).toBe(4);
  });

  it('keeps the local day when an instant is late in the evening', () => {
    // 23:30 is the hour a UTC round trip would push into tomorrow for anybody
    // east of Greenwich; the anchor stays on the day the person is living in.
    const anchor = startOfDay(new Date(2026, 9, 4, 23, 30));
    expect(anchor.getDate()).toBe(4);
    expect(sameDay(anchor, dayAt(2026, 9, 4))).toBe(true);
  });

  it('counts whole days across a month boundary and a leap day', () => {
    expect(dayDiff(dayAt(2026, 9, 4), dayAt(2026, 9, 11))).toBe(7);
    expect(dayDiff(dayAt(2028, 1, 28), dayAt(2028, 2, 1))).toBe(2);
    expect(dayDiff(dayAt(2026, 9, 11), dayAt(2026, 9, 4))).toBe(-7);
  });

  it('walks months without spilling into the next one', () => {
    expect(sameDay(addMonths(dayAt(2026, 0, 31), 1), dayAt(2026, 1, 1))).toBe(true);
    expect(sameDay(addMonths(dayAt(2026, 0, 15), -1), dayAt(2025, 11, 1))).toBe(true);
    expect(sameDay(firstOfMonth(dayAt(2026, 9, 27)), dayAt(2026, 9, 1))).toBe(true);
  });
});

describe('gregorianFormatter', () => {
  it('names the Gregorian month even where the locale prefers another calendar', () => {
    // `ar-SA` resolves to the Umm al-Qura Hijri calendar by default, which
    // would label a Gregorian grid with a month it is not showing.
    const formatter = gregorianFormatter('ar-SA', { month: 'long', year: 'numeric' });
    expect(formatter?.resolvedOptions().calendar).toBe('gregory');
  });

  it('formats in the language the reader chose', () => {
    const formatter = gregorianFormatter('en-GB', { month: 'long', year: 'numeric' });
    expect(formatter?.format(dayAt(2026, 9, 4))).toContain('October');
  });
});
