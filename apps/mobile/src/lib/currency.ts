/**
 * The currency a new expense, group or IOU should start on for the person
 * holding the phone.
 *
 * Signed in, this is their account currency — `profiles.default_currency`, set
 * from the country they chose on "Your account" (see `currencyForCountry`). So
 * a user in Dubai gets AED everywhere without setting it per group, and one who
 * moves and changes their country moves the default with them. Before there is
 * a profile (a guest, or the split second before it loads) it falls back to the
 * phone's own region — the same guess `deviceDefaultCurrency` has always made.
 *
 * Always a default, never a lock: every group and every expense can still be
 * counted in something else.
 */

import type { CurrencyCode } from '@waves/core';
import { currencyForCountry } from '@waves/core';

import { deviceDefaultCurrency } from '@/i18n';
import { useAuth } from '@/lib/auth';

export function useDefaultCurrency(): CurrencyCode {
  const { profile } = useAuth();
  if (profile) {
    // `default_currency` is set from the country and always present, but guard
    // an unexpected empty string, and cross-check the country in case an older
    // row never had its currency written.
    return (
      (profile.default_currency as CurrencyCode) ||
      currencyForCountry(profile.country_code) ||
      deviceDefaultCurrency()
    );
  }
  return deviceDefaultCurrency();
}

/**
 * The currency a summary card totals in. The default (device region before the profile loads, e.g.
 * after an offline start) can match none of the records, which would total a wrong "$0";
 * then use the first record's own currency.
 */
export function summaryCurrency(
  fallback: CurrencyCode,
  recordCurrencies: readonly (CurrencyCode | '' | null | undefined)[],
): CurrencyCode {
  const own = recordCurrencies.map((c) => c || fallback);
  return own.includes(fallback) ? fallback : (own[0] ?? fallback);
}
