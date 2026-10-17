/**
 * Where the person's statements come from, as far as the app can tell.
 *
 * The country is a default, never a verdict: it picks the currency and which
 * way round a date is written when the file itself cannot say. A statement from
 * a US bank opened by someone in the UK is still read as US where the file says
 * so (a day above 12, a named bank profile, the statement's own header).
 */

import { currencyForCountry, defaultDateOrder, type ImportDateOrder } from '@waves/core';

export interface StatementRegion {
  /** ISO 3166-1 alpha-2, upper case; `UK` is read as `GB`. Null when unknown. */
  readonly country: string | null;
  readonly currency: string;
  readonly dateOrder: ImportDateOrder;
}

export function statementRegion(
  accountCountry: string | null | undefined,
  localeRegion?: string | null,
): StatementRegion {
  const raw = (accountCountry || localeRegion || '').trim().toUpperCase();
  const country = raw === 'UK' ? 'GB' : raw.length === 2 ? raw : null;
  return {
    country,
    currency: (country ? currencyForCountry(country) : null) || 'INR',
    dateOrder: defaultDateOrder(country),
  };
}

/** The other way round, for the "read as" switch. */
export const otherOrder = (order: ImportDateOrder): ImportDateOrder =>
  order === 'dmy' ? 'mdy' : 'dmy';
