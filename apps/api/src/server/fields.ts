/**
 * The handful of columns whose type is narrower than "text".
 *
 * `default_currency` is `character(3)` and `country_code` is `character(2)`, so
 * a four-letter currency does not fail a validation rule — it fails Postgres,
 * with "value too long for type character(3)", which reaches a developer as an
 * opaque 500 about somebody else's database. That is the whole reason this file
 * exists: not to re-implement the constraint, which is where the truth stays,
 * but to make the refusal a sentence the caller can act on.
 *
 * Everything here is deliberately a shape check and nothing more. Whether `XYZ`
 * is a currency anyone uses, or `ZZ` a country that exists, is not this layer's
 * question — the ledger's own rules answer it, and a hard-coded list here would
 * be one more place to forget when a market opens.
 */

import { ApiError } from './errors';

function bad(field: string, expectation: string): never {
  throw new ApiError('invalid_request', `${field} ${expectation}`, {}, { field });
}

export function currencyOrThrow(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    bad(field, 'is a three-letter ISO 4217 code, upper case — "INR", "GBP".');
  }
  return value;
}

export function countryOrThrow(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[A-Z]{2}$/.test(value)) {
    bad(field, 'is a two-letter ISO 3166-1 code, upper case — "IN", "GB".');
  }
  return value;
}

export function dateOrThrow(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    bad(field, 'is a calendar date, YYYY-MM-DD.');
  }
  return value;
}

export function localeOrThrow(value: unknown, field: string): string {
  // BCP 47 in the loose form the app actually stores: `en`, `ta`, `hi-IN`.
  if (typeof value !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(value)) {
    bad(field, 'is a language tag — "en", "ta", "hi-IN".');
  }
  return value;
}

export function textOrThrow(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) bad(field, 'cannot be empty.');
  if (value.length > max) bad(field, `is at most ${max} characters.`);
  return value.trim();
}

export function boolOrThrow(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') bad(field, 'is true or false.');
  return value;
}
