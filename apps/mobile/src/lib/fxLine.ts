/**
 * The words around a foreign-currency amount, kept out of the components so
 * they can be tested without React Native.
 *
 * Plain on purpose: "1 $ = ₹93.00 · today's rate", never "mid-market" or
 * "quote". Presentation only — the stored rate and the conversion are untouched.
 */

import { fromFxRecord, minorUnitExponent, rateToDecimal, type FxRecord } from '@waves/core';

import { ratePlaces, rateLine } from '@/lib/tripRates';

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

/** 456250 minor units of INR → "4562.50": plain digits for an input box. */
export function minorToPlain(minor: bigint, currency: string): string {
  const exponent = minorUnitExponent(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}${exponent > 0 ? `.${fraction}` : ''}`;
}

/** "1 USD =" and "83.24 INR": the rate as the big line on the sheet. */
export function rateParts(fx: FxRecord): { left: string; right: string } {
  const rate = fromFxRecord(fx);
  const places = ratePlaces(Number(rate.num) / Number(rate.den));
  return {
    left: `1 ${rate.from} =`,
    right: `${padTo2(rateToDecimal(rate, Math.max(places, 2)))} ${rate.to}`,
  };
}

export interface UpdatedStrings {
  sheetUpdatedNow: string;
  sheetUpdatedMin: string;
  sheetUpdatedHour: string;
  sheetUpdatedDay: string;
}

/** "Updated just now" / "Updated 2 min ago"; null when the time is unusable. */
export function updatedAgo(ts: string, now: number, words: UpdatedStrings): string | null {
  const then = Date.parse(ts);
  if (!Number.isFinite(then)) return null;
  const minutes = Math.max(0, Math.floor((now - then) / 60000));
  if (minutes < 1) return words.sheetUpdatedNow;
  if (minutes < 60) return words.sheetUpdatedMin.replace('{n}', String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return words.sheetUpdatedHour.replace('{n}', String(hours));
  return words.sheetUpdatedDay.replace('{n}', String(Math.floor(hours / 24)));
}

/** "93" → "93.00", "83.2" → "83.2" → "83.20": at least two decimals. */
function padTo2(text: string): string {
  const [whole = '0', fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}
