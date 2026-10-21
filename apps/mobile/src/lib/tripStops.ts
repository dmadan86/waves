/**
 * The itinerary as a person reads it: one stop's line, and the sentence for a
 * refused one. Pure and React-Native-free so the stops sheet's words can be
 * tested without a renderer; the calendar rules are @waves/core's.
 */

import {
  currencyForStop,
  StopError,
  stopForDate,
  type CurrencyCode,
  type TripStop,
} from '@waves/core';

import type { UiStrings } from '@/i18n';
import { formatShortDateRange } from '@/lib/tripDateRange';

/** A stop's line under its name: "1–5 Oct · IDR". */
export function stopLine(stop: TripStop, locale: string): string {
  const range = formatShortDateRange(stop.start, stop.end, locale) ?? `${stop.start} – ${stop.end}`;
  const code = currencyForStop(stop);
  return code ? `${range} · ${code}` : range;
}

/** The sentence for a refused itinerary, by the rule it broke. */
export function stopErrorText(code: StopError, t: UiStrings): string {
  switch (code) {
    case StopError.Overlap:
      return t.stops.overlap;
    case StopError.OutsideTrip:
      return t.stops.outsideTrip;
    case StopError.EndBeforeStart:
      return t.stops.endBeforeStart;
    case StopError.TooMany:
      return t.stops.tooMany;
    default:
      return t.couldNotSave;
  }
}

/**
 * The currency a bill dated `day` starts in, by the itinerary: the stop that
 * day falls in, or null when none does and the group's own currency stands.
 *
 * A hook rather than a bare call, for the React Compiler's sake: the form
 * memoises its split on the currency it arrives at, and a value that came out
 * of a hook is one the compiler knows nothing later will move.
 */
export function useStopCurrency(
  stops: readonly TripStop[],
  day: string | null | undefined,
): CurrencyCode | null {
  return currencyForStop(stopForDate(stops, day));
}
