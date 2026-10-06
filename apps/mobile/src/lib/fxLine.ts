/**
 * The words around a foreign-currency amount, kept out of the components so
 * they can be tested without React Native.
 *
 * Plain on purpose: "1 $ = ₹93.00 · today's rate", never "mid-market" or
 * "quote". Presentation only — the stored rate and the conversion are untouched.
 */

import { fromFxRecord, type FxRecord } from '@waves/core';

import { rateLine } from '@/lib/tripRates';

export type RateOrigin = 'today' | 'yours' | 'trip';

/**
 * Where a rate came from, in the three ways a person would say it.
 * A fetched market rate is "today's"; a pinned trip rate is the trip's; anything
 * typed or implied from a card statement is the person's own.
 */
export function rateOrigin(fx: FxRecord, onTripRate = false): RateOrigin {
  if (onTripRate) return 'trip';
  return fx.source === 'ecb' ? 'today' : 'yours';
}

export interface RateNoteStrings {
  rateToday: string;
  rateYours: string;
  rateTrip: string;
}

/** "1 $ = ₹93.00 · today's rate". */
export function rateNote(fx: FxRecord, origin: RateOrigin, words: RateNoteStrings): string {
  const label =
    origin === 'trip' ? words.rateTrip : origin === 'today' ? words.rateToday : words.rateYours;
  return `${rateLine(fromFxRecord(fx))} · ${label}`;
}

/** "at 1 $ = ₹93.00" for a saved expense. */
export function rateAt(fx: FxRecord, template: string): string {
  return template.replace('{rate}', rateLine(fromFxRecord(fx)));
}
