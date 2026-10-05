/**
 * The account's default currency: derived from the country until the person
 * picks one themselves. Only `profile.default_currency` is stored, so "chosen
 * by you" is simply "differs from what the country would give".
 */

export type CurrencyOrigin = 'country' | 'chosen';

/** Whether the stored currency is the country's own or one the person picked. */
export function currencyOrigin(
  stored: string | null | undefined,
  countryDefault: string | null | undefined,
): CurrencyOrigin {
  if (!stored || !countryDefault) return 'country';
  return stored.toUpperCase() === countryDefault.toUpperCase() ? 'country' : 'chosen';
}

/**
 * The currency to store when the country changes: a chosen currency is kept,
 * a country-derived one follows the new country (falling back to what is stored).
 */
export function currencyAfterCountryChange(
  stored: string | null | undefined,
  priorCountryDefault: string | null | undefined,
  nextCountryDefault: string | null | undefined,
  fallback = 'INR',
): string {
  if (currencyOrigin(stored, priorCountryDefault) === 'chosen' && stored) return stored;
  return nextCountryDefault ?? stored ?? fallback;
}
