/**
 * Small formatters for the import screens.
 */

import { minorUnitExponent, type CurrencyCode } from '@waves/core';

/**
 * A `YYYY-MM-DD` as "1 Oct" (or "1 Oct 2026"). Read as a calendar day, not a
 * moment: parsing it in the phone's zone would show the day before for anyone
 * west of Greenwich.
 */
export function formatIsoDate(iso: string, locale: string, withYear = false): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!day) return iso;
  const date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return iso;
  }
}

/** Minor units as plain digits with a dot, no grouping: what goes back into an amount field. */
export function minorToPlain(minor: bigint, currency: CurrencyCode): string {
  const exponent = minorUnitExponent(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}${exponent > 0 ? `.${fraction}` : ''}`;
}

/** Whether `text` is a real `YYYY-MM-DD` day. */
export function isIsoDay(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
