/**
 * The arithmetic and the localisation behind a month grid, with no React and no
 * React Native in sight.
 *
 * {@link RangeCalendar} draws the grid; everything that could be silently wrong
 * about it lives here instead, where a test can hold it. Two things in
 * particular are worth pinning down rather than eyeballing on a device: which
 * weekday a week opens on (Saturday in Cairo, Sunday in Chennai and Riyadh,
 * Monday in Dubai and Berlin — get it wrong and every row is off by a column),
 * and which calendar system the labels name.
 *
 * Every day here is anchored at local noon. A calendar day is not an instant:
 * anchoring at midnight puts a day within an hour of the boundary that daylight
 * saving moves, and noon is the one hour of the day no time zone shift has ever
 * crossed.
 */

/** A calendar day at local noon — the anchor the whole grid works in. */
export function dayAt(year: number, month: number, date: number): Date {
  return new Date(year, month, date, 12, 0, 0, 0);
}

/** The day-anchor for whatever day an instant falls on, locally. */
export function startOfDay(d: Date): Date {
  return dayAt(d.getFullYear(), d.getMonth(), d.getDate());
}

export function firstOfMonth(d: Date): Date {
  return dayAt(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, delta: number): Date {
  return dayAt(d.getFullYear(), d.getMonth() + delta, 1);
}

/** Whole days between two day-anchors (b − a), sign preserved. */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * A date formatter in the reader's language, pinned to the Gregorian calendar.
 *
 * The grid is built out of JavaScript `Date`, which knows only Gregorian months
 * and Gregorian day numbers. Left alone, `Intl` labels that grid with whatever
 * calendar the locale prefers — `ar-SA` resolves to the Umm al-Qura Hijri
 * calendar — and a Hijri month name written over a Gregorian grid names
 * something the grid is not. Pinning the label to the calendar the grid is
 * actually drawn in keeps the two telling the same story; the language, and
 * with it the numbering system, still belongs to the reader.
 *
 * A phone whose engine refuses the option, or the locale, gets the next best
 * formatter rather than an exception — these are captions, not computations.
 */
export function gregorianFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory' });
  } catch {
    try {
      return new Intl.DateTimeFormat(locale, options);
    } catch {
      return null;
    }
  }
}

/**
 * Where a week does not open on Monday.
 *
 * A calendar that starts its week on the wrong day is not a cosmetic slip: the
 * columns are a reader's mental model of a week, and somebody in Cairo counting
 * from Monday has to translate every row. Monday is the default because it is
 * both ISO-8601 and the commonest answer worldwide, so only the places that
 * disagree are written out and the table stays short enough to read.
 *
 * These follow CLDR, and CLDR moves: Saudi Arabia's week now opens on Sunday
 * and the UAE's on Monday, both of them changes of the last few years, and both
 * of them countries a stale table would still have opening on Saturday. That
 * churn is exactly why {@link firstWeekday} asks the engine before it consults
 * this list — the table is the answer for phones whose engine has none.
 */
const WEEK_STARTS_SATURDAY = new Set([
  'AF',
  'BH',
  'DJ',
  'DZ',
  'EG',
  'IQ',
  'IR',
  'JO',
  'KW',
  'LY',
  'OM',
  'QA',
  'SD',
  'SY',
]);

const WEEK_STARTS_SUNDAY = new Set([
  'AG',
  'AS',
  'BD',
  'BR',
  'BS',
  'BT',
  'BW',
  'BZ',
  'CA',
  'CO',
  'DO',
  'ET',
  'GT',
  'GU',
  'HK',
  'HN',
  'ID',
  'IL',
  'IN',
  'JM',
  'JP',
  'KE',
  'KH',
  'KR',
  'LA',
  'MH',
  'MM',
  'MO',
  'MT',
  'MX',
  'MZ',
  'NI',
  'NP',
  'PA',
  'PE',
  'PH',
  'PK',
  'PR',
  'PT',
  'PY',
  'SA',
  'SG',
  'SV',
  'TH',
  'TT',
  'TW',
  'US',
  'VE',
  'YE',
  'ZA',
  'ZW',
]);

/** The Maldives, and nowhere else, opens its week on Friday. */
const WEEK_STARTS_FRIDAY = new Set(['MV']);

/** What `Intl.Locale.getWeekInfo` returns where an engine implements it. */
interface WeekInfoCarrier {
  getWeekInfo?: () => { firstDay?: number };
  weekInfo?: { firstDay?: number };
}

/**
 * Which weekday this reader's week starts on, as `Date.getDay` counts them
 * (0 = Sunday).
 *
 * The engine is asked first: where `Intl.Locale` carries week info it holds the
 * whole of CLDR and beats any table written here. It numbers days 1 = Monday
 * through 7 = Sunday, so Sunday's 7 has to come back round to 0. Only when the
 * engine has no answer — and the Hermes builds this app ships on generally do
 * not — does the region table decide, falling back to the language when the tag
 * carries no region at all.
 */
export function firstWeekday(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as unknown as WeekInfoCarrier;
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (typeof first === 'number' && first >= 1 && first <= 7) return first % 7;
  } catch {
    // An engine without `Intl.Locale`, or a tag it will not parse. The table
    // below is the answer, not a crash.
  }

  // The region sits in a fixed place in a BCP-47 tag: straight after the
  // language, or after the four-letter script when there is one. Hunting for
  // "the first two-letter part" instead would read the `ca` of
  // `ar-u-ca-islamic` as Canada.
  const parts = locale.split(/[-_]/);
  const afterScript = parts[1] && /^[A-Za-z]{4}$/.test(parts[1]) ? parts[2] : parts[1];
  const region =
    afterScript && /^[A-Za-z]{2}$/.test(afterScript) ? afterScript.toUpperCase() : null;
  if (region) {
    if (WEEK_STARTS_FRIDAY.has(region)) return 5;
    if (WEEK_STARTS_SATURDAY.has(region)) return 6;
    if (WEEK_STARTS_SUNDAY.has(region)) return 0;
    return 1;
  }

  // A bare language tag, with no region to look up. Arabic without one is
  // likeliest to be read in Egypt, where the week opens on Saturday; the other
  // three languages Waves speaks are read where it opens on Sunday.
  const language = parts[0]?.toLowerCase();
  if (language === 'ar') return 6;
  if (language === 'en' || language === 'hi' || language === 'ta') return 0;
  return 1;
}

/**
 * The month laid out in weeks, each week seven slots long, with `null` for the
 * lead and trail slots that belong to the neighbouring months.
 *
 * The lead is counted from the reader's own first weekday rather than from
 * Sunday, which is the whole reason this is a function and not a loop inlined
 * in the view.
 */
export function monthGrid(view: Date, weekStart: number): (Date | null)[][] {
  const first = firstOfMonth(view);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const daysInMonth = dayDiff(first, addMonths(view, 1));
  const cells: (Date | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      dayAt(view.getFullYear(), view.getMonth(), i + 1),
    ),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
