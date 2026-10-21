/**
 * A trip across several countries: its itinerary of stops.
 *
 * Bali, then Singapore, then Vietnam is three currencies on one group. The
 * group keeps settling in its own currency (`default_currency`, the home
 * country's — `country_code` still means where the money squares up); what
 * this adds is *where the group was on which days*, so a bill can start in the
 * currency of the place it was paid, and the Spending screen can say what each
 * country cost.
 *
 * Stored on the group row as `trip_stops`, a JSON list of
 * `{ country, start, end }` — ISO-3166 alpha-2, and two inclusive `YYYY-MM-DD`
 * days — the same shape of thing as `fx_rates` and `category_budgets`:
 * group-visible, admin-set, a handful of entries, always read whole. Written
 * only through `waves_set_trip_stops`, which re-runs `validateStops`'s rules in
 * SQL; this module is the client's copy so a sheet can refuse an overlap
 * before anything is queued.
 *
 * Dates are compared as strings. `YYYY-MM-DD` sorts the way the calendar does,
 * and parsing would only invite a timezone to move a day.
 */

import { convert, fxRate, type FxRate } from '../money/fx';
import { groupFxRate, type GroupFxRates } from '../money/fxPolicy';
import { money } from '../money/money';
import { type CurrencyCode } from '../money/currency';
import { currencyForCountry, isCountryCode } from '../money/region';
import { usableFx } from '../balances/convert';

/** One leg of the itinerary: a country and the inclusive days spent there. */
export interface TripStop {
  /** ISO-3166 alpha-2, upper case. */
  readonly country: string;
  /** `YYYY-MM-DD`, inclusive. */
  readonly start: string;
  /** `YYYY-MM-DD`, inclusive; never before `start`. */
  readonly end: string;
}

/** The most stops a trip may carry; mirrored by the RPC. */
export const TRIP_STOPS_MAX = 15;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a real calendar day written as `YYYY-MM-DD`. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Why a list of stops was refused. The RPC raises the same codes. */
export enum StopError {
  BadCountry = 'BAD_COUNTRY',
  BadDate = 'BAD_DATE',
  EndBeforeStart = 'END_BEFORE_START',
  Overlap = 'OVERLAP',
  OutsideTrip = 'OUTSIDE_TRIP',
  TooMany = 'TOO_MANY',
}

export type StopsVerdict =
  | { readonly ok: true; readonly stops: readonly TripStop[] }
  | { readonly ok: false; readonly code: StopError; readonly index: number };

/** Earliest start first; a tie keeps the earlier end first. */
export function sortStops(stops: readonly TripStop[]): TripStop[] {
  return [...stops].sort((a, b) =>
    a.start !== b.start ? (a.start < b.start ? -1 : 1) : a.end < b.end ? -1 : a.end > b.end ? 1 : 0,
  );
}

/**
 * The rules every stored itinerary obeys, in the order a person meets them.
 *
 * Returns the stops normalised (countries upper-cased, sorted by start) when
 * they pass, or the first rule broken and which stop broke it, so a sheet can
 * point at the row. `bounds` are the trip's own dates when it has them: a stop
 * cannot lie outside the trip, because the trip is the thing being described.
 */
export function validateStops(
  stops: readonly { country: string; start: string; end: string }[],
  bounds: { readonly start?: string | null; readonly end?: string | null } = {},
): StopsVerdict {
  if (stops.length > TRIP_STOPS_MAX) {
    return { ok: false, code: StopError.TooMany, index: TRIP_STOPS_MAX };
  }
  const cleaned: TripStop[] = [];
  for (const [index, stop] of stops.entries()) {
    if (!isCountryCode(stop.country)) return { ok: false, code: StopError.BadCountry, index };
    if (!isIsoDay(stop.start) || !isIsoDay(stop.end)) {
      return { ok: false, code: StopError.BadDate, index };
    }
    if (stop.end < stop.start) return { ok: false, code: StopError.EndBeforeStart, index };
    if ((bounds.start && stop.start < bounds.start) || (bounds.end && stop.end > bounds.end)) {
      return { ok: false, code: StopError.OutsideTrip, index };
    }
    cleaned.push({ country: stop.country.trim().toUpperCase(), start: stop.start, end: stop.end });
  }
  // Overlap is a property of the pair, so it is checked on the sorted list —
  // but reported against the stop's place in the list that was handed in,
  // which is the row the person is looking at.
  const order = cleaned
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => (a.stop.start < b.stop.start ? -1 : a.stop.start > b.stop.start ? 1 : 0));
  for (let i = 1; i < order.length; i += 1) {
    const previous = order[i - 1]!;
    const current = order[i]!;
    if (current.stop.start <= previous.stop.end) {
      return { ok: false, code: StopError.Overlap, index: current.index };
    }
  }
  return { ok: true, stops: sortStops(cleaned) };
}

/**
 * The stored column, read tolerantly. A malformed entry is dropped rather than
 * thrown on: the group row has to render whatever an older client or a bad
 * write left there, and `validateStops` guards the way in.
 */
export function parseTripStops(raw: unknown): TripStop[] {
  if (!Array.isArray(raw)) return [];
  const stops: TripStop[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const country = typeof record.country === 'string' ? record.country.trim().toUpperCase() : '';
    if (!isCountryCode(country) || !isIsoDay(record.start) || !isIsoDay(record.end)) continue;
    if (record.end < record.start) continue;
    stops.push({ country, start: record.start, end: record.end });
  }
  return sortStops(stops);
}

/** The stop whose days include `date`, or null when the trip was nowhere in particular. */
export function stopForDate(
  stops: readonly TripStop[],
  date: string | null | undefined,
): TripStop | null {
  if (!date) return null;
  return stops.find((stop) => stop.start <= date && date <= stop.end) ?? null;
}

/**
 * What a stop spends: the country's currency, through the same table that
 * picks a new group's default. Null when the table has no opinion — then a bill
 * there starts in the group's currency, exactly as it did before.
 */
export function currencyForStop(stop: TripStop | null | undefined): CurrencyCode | null {
  return stop ? currencyForCountry(stop.country) : null;
}

/**
 * The currencies the itinerary will be paid in, in itinerary order, without
 * the group's own and without repeats. These are the rates the trip needs
 * pinned, and the chips a bill's currency picker leads with.
 */
export function stopCurrencies(
  stops: readonly TripStop[],
  groupCurrency: CurrencyCode,
): CurrencyCode[] {
  const out: CurrencyCode[] = [];
  for (const stop of sortStops(stops)) {
    const code = currencyForStop(stop);
    if (code && code !== groupCurrency && !out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * The half of an expense the per-country total reads. Structural, like
 * `SpendingExpense`, so the phone's mirrored row and the browser's REST row
 * both satisfy it.
 */
export interface StopSpendExpense {
  readonly id: string;
  readonly deleted_at?: string | null;
  readonly currentVersion: {
    readonly currency: string;
    /** 'YYYY-MM-DD'. */
    readonly expense_date: string;
    /** The whole bill, minor units as text. */
    readonly amount: string;
    readonly shares: readonly { readonly member_id: string; readonly amount: string }[];
    /** The rate the bill was written with (ADR-003), when foreign. */
    readonly fx?: unknown;
  } | null;
}

/** What one stop cost, in the group's currency. */
export interface StopSpend {
  /** The leg, or null for the bills dated outside every stop ("Other dates"). */
  readonly stop: TripStop | null;
  /** The converted total in `currency`, minor units. */
  readonly totalMinor: bigint;
  readonly currency: CurrencyCode;
  /** Bills that count toward `totalMinor`. */
  readonly expenseCount: number;
  /**
   * Foreign bills with no usable rate, per currency: real money, left in its
   * own currency rather than guessed at. Reported so the screen can say "2 VND
   * bills are not counted" instead of silently drawing a smaller number.
   */
  readonly unconverted: Readonly<Record<string, bigint>>;
  readonly unconvertedCount: number;
}

const DIGITS = /^-?[0-9]+$/;

function minor(value: string | undefined): bigint {
  return value !== undefined && DIGITS.test(value) ? BigInt(value) : 0n;
}

/**
 * Spend per stop, converted into the group's currency the way the ledger
 * converts (ADR-003 amendment): a foreign bill at the rate saved on it, and
 * failing that at the trip's pinned rate for its currency; a bill with neither
 * is reported as unconverted rather than guessed at today's rate.
 *
 * Each bill is filed by its date under the stop whose days include it, and
 * under "Other dates" (`stop: null`) when none does — a flight home booked a
 * month before, a taxi on a day between two stops. That bucket is returned
 * only when it has something in it, after the stops.
 *
 * `memberId` narrows every bill to that member's share — the "Just me" scope —
 * instead of the whole amount. Shares are what the ledger stored and are never
 * re-divided here.
 */
export function spendByCountry(
  expenses: readonly StopSpendExpense[],
  stops: readonly TripStop[],
  groupCurrency: CurrencyCode,
  options: { readonly tripRates?: GroupFxRates | null; readonly memberId?: string | null } = {},
): StopSpend[] {
  const ordered = sortStops(stops);
  interface Bucket {
    total: bigint;
    count: number;
    unconverted: Record<string, bigint>;
    unconvertedCount: number;
  }
  const bucket = (): Bucket => ({ total: 0n, count: 0, unconverted: {}, unconvertedCount: 0 });
  const perStop = ordered.map(bucket);
  const other = bucket();

  for (const expense of expenses) {
    if (expense.deleted_at) continue;
    const version = expense.currentVersion;
    if (!version) continue;

    const amount = options.memberId
      ? version.shares
          .filter((share) => share.member_id === options.memberId)
          .reduce((sum, share) => sum + minor(share.amount), 0n)
      : minor(version.amount);
    if (amount === 0n) continue;

    const index = ordered.findIndex(
      (stop) => stop.start <= version.expense_date && version.expense_date <= stop.end,
    );
    const target = index === -1 ? other : perStop[index]!;

    const converted = toGroupCurrency(amount, version, groupCurrency, options.tripRates ?? null);
    if (converted === null) {
      target.unconverted[version.currency] = (target.unconverted[version.currency] ?? 0n) + amount;
      target.unconvertedCount += 1;
    } else {
      target.total += converted;
      target.count += 1;
    }
  }

  const out: StopSpend[] = ordered.map((stop, index) => {
    const entry = perStop[index]!;
    return {
      stop,
      totalMinor: entry.total,
      currency: groupCurrency,
      expenseCount: entry.count,
      unconverted: entry.unconverted,
      unconvertedCount: entry.unconvertedCount,
    };
  });
  if (other.count > 0 || other.unconvertedCount > 0) {
    out.push({
      stop: null,
      totalMinor: other.total,
      currency: groupCurrency,
      expenseCount: other.count,
      unconverted: other.unconverted,
      unconvertedCount: other.unconvertedCount,
    });
  }
  return out;
}

/** The bill in the group's currency, or null when there is no honest rate for it. */
function toGroupCurrency(
  amount: bigint,
  version: { readonly currency: string; readonly fx?: unknown },
  groupCurrency: CurrencyCode,
  tripRates: GroupFxRates | null,
): bigint | null {
  if (version.currency === groupCurrency) return amount;
  const stored = usableFx(version.fx, version.currency, groupCurrency);
  let rate: FxRate | null = null;
  if (stored) {
    rate = fxRate({
      num: stored.num,
      den: stored.den,
      from: version.currency,
      to: groupCurrency,
      ts: '',
      source: 'expense',
    });
  } else {
    rate = groupFxRate(tripRates, version.currency, groupCurrency);
  }
  if (!rate) return null;
  try {
    return convert(money(amount, version.currency), rate).minor;
  } catch {
    // An unknown currency code cannot be scaled; it is money we cannot count.
    return null;
  }
}
