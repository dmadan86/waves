/**
 * Private dates: the next time one comes round, a small festival calendar, and
 * the "what is coming up" list the Upcoming card shows. Pure — "today" comes in
 * as the person's LOCAL `YYYY-MM-DD` (the caller owns the clock and the
 * timezone), so nothing here can shift a day for anybody who is not on UTC.
 */

import { dayDelta } from './compute';
import type { DateLabelKind, PersonalDate } from './types';

export type FestivalId =
  | 'diwali'
  | 'holi'
  | 'eid_al_fitr'
  | 'eid_al_adha'
  | 'christmas'
  | 'pongal'
  | 'onam'
  | 'raksha_bandhan'
  | 'navratri'
  | 'thanksgiving'
  | 'easter'
  | 'ramadan_start'
  | 'lunar_new_year'
  | 'hanukkah';

/** Published/calculated dates through 2030 (Islamic dates may vary by sighting). */
const FESTIVAL_DATES: Readonly<Record<FestivalId, readonly string[]>> = {
  diwali: ['2026-11-08', '2027-10-29', '2028-10-17', '2029-11-05', '2030-10-26'],
  holi: ['2026-03-04', '2027-03-22', '2028-03-11', '2029-02-28', '2030-03-20'],
  eid_al_fitr: ['2026-03-20', '2027-03-09', '2028-02-26', '2029-02-14', '2030-02-04'],
  eid_al_adha: ['2026-05-27', '2027-05-16', '2028-05-05', '2029-04-24', '2030-04-13'],
  christmas: ['2026-12-25', '2027-12-25', '2028-12-25', '2029-12-25', '2030-12-25'],
  pongal: ['2026-01-14', '2027-01-15', '2028-01-15', '2029-01-15', '2030-01-14'],
  onam: ['2026-08-26', '2027-09-12', '2028-09-01', '2029-08-28', '2030-09-09'],
  raksha_bandhan: ['2026-08-28', '2027-08-17', '2028-08-05', '2029-08-24', '2030-08-14'],
  navratri: ['2026-10-11', '2027-10-01', '2028-09-30', '2029-10-08', '2030-09-27'],
  thanksgiving: ['2026-11-26', '2027-11-25', '2028-11-23', '2029-11-22', '2030-11-28'],
  easter: ['2026-04-05', '2027-03-28', '2028-04-16', '2029-04-01', '2030-04-21'],
  ramadan_start: [
    '2026-02-18',
    '2027-02-08',
    '2028-01-28',
    '2029-01-16',
    '2030-01-05',
    '2030-12-26',
  ],
  lunar_new_year: ['2026-02-17', '2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03'],
  hanukkah: ['2026-12-04', '2027-12-24', '2028-12-12', '2029-12-01', '2030-12-20'],
};

const COMMON: readonly FestivalId[] = [
  'christmas',
  'eid_al_fitr',
  'eid_al_adha',
  'diwali',
  'easter',
];
const INDIA: readonly FestivalId[] = [
  'diwali',
  'holi',
  'eid_al_fitr',
  'eid_al_adha',
  'christmas',
  'pongal',
  'onam',
  'raksha_bandhan',
  'navratri',
];

/** The festivals on by default for a country. Never asks religion; the person
 *  switches individual ones off. Unknown country gets the common set. */
export function defaultFestivals(countryCode: string | null | undefined): readonly FestivalId[] {
  const c = (countryCode ?? '').toUpperCase();
  if (c === 'IN') return INDIA;
  if (c === 'US') return [...COMMON, 'thanksgiving'];
  return COMMON;
}

const pad = (n: number): string => String(n).padStart(2, '0');

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * The next time day/month falls on or after `todayIso`. 29 Feb is kept on
 * 28 Feb in a non-leap year (so it is never skipped for four years).
 */
export function nextOccurrence(
  day: number,
  month: number,
  todayIso: string,
): { date: string; inDays: number } {
  const year = Number(todayIso.slice(0, 4));
  const on = (y: number): string => {
    const d = month === 2 && day === 29 && !isLeap(y) ? 28 : day;
    return `${y}-${pad(month)}-${pad(d)}`;
  };
  let date = on(year);
  if (date < todayIso) date = on(year + 1);
  return { date, inDays: dayDelta(todayIso, date) };
}

/** Next festival date on or after today, or null when the table has run out. */
export function nextFestival(
  id: FestivalId,
  todayIso: string,
): { date: string; inDays: number } | null {
  const date = FESTIVAL_DATES[id].find((d) => d >= todayIso);
  return date ? { date, inDays: dayDelta(todayIso, date) } : null;
}

export interface UpcomingItem {
  /** Unique per occurrence — what "Not this time" remembers. */
  readonly key: string;
  readonly source: 'date' | 'festival';
  readonly kind: DateLabelKind | 'festival';
  /** The record id, or the festival id. */
  readonly id: string;
  readonly name: string;
  readonly date: string;
  readonly inDays: number;
  /** Work anniversary only: completed years on that day. */
  readonly years: number | null;
}

export const UPCOMING_WINDOW_DAYS = 30;
export const FESTIVAL_WINDOW_DAYS = 21;

/** Every date/festival that has an occurrence, soonest first, not yet trimmed. */
export function allOccurrences(input: {
  readonly dates: readonly PersonalDate[];
  readonly country: string | null | undefined;
  readonly festivalsOff: readonly string[];
  readonly todayIso: string;
}): UpcomingItem[] {
  const out: UpcomingItem[] = [];
  for (const d of input.dates) {
    const next = nextOccurrence(d.day, d.month, input.todayIso);
    const years =
      d.label === 'work_anniversary' && d.year ? Number(next.date.slice(0, 4)) - d.year : null;
    out.push({
      key: `${d.id}:${next.date}`,
      source: 'date',
      kind: d.label,
      id: d.id,
      name: d.name,
      date: next.date,
      inDays: next.inDays,
      years: years !== null && years > 0 ? years : null,
    });
  }
  for (const id of defaultFestivals(input.country)) {
    if (input.festivalsOff.includes(id)) continue;
    const next = nextFestival(id, input.todayIso);
    if (!next) continue;
    out.push({
      key: `${id}:${next.date}`,
      source: 'festival',
      kind: 'festival',
      id,
      name: '',
      date: next.date,
      inDays: next.inDays,
      years: null,
    });
  }
  return out.sort((a, b) => a.inDays - b.inDays || (a.key < b.key ? -1 : 1));
}

/** Trim occurrences to the Upcoming card: within 30 days (festivals 21), first few. */
export function pickUpcoming(items: readonly UpcomingItem[], limit = 3): UpcomingItem[] {
  return items
    .filter(
      (i) => i.inDays <= (i.source === 'festival' ? FESTIVAL_WINDOW_DAYS : UPCOMING_WINDOW_DAYS),
    )
    .slice(0, limit);
}

export function upcomingDates(
  input: Parameters<typeof allOccurrences>[0] & { readonly limit?: number },
): UpcomingItem[] {
  return pickUpcoming(allOccurrences(input), input.limit);
}
