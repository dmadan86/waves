/**
 * The currencies the app offers in the small mobile pickers.
 *
 * This is deliberately not every ISO-4217 code: the mobile sheets need a short,
 * tappable list. It must, however, cover the currencies the rest of the app can
 * already recognise from travel speech/SMS so a traveller is not told in prose
 * that Vietnam works and then blocked from choosing VND in the trip-rate UI.
 */
export const COMMON_CURRENCIES = [
  'INR',
  'USD',
  'EUR',
  'GBP',
  'AED',
  'SGD',
  'AUD',
  'THB',
  'VND',
  'IDR',
  'MYR',
  'PHP',
  'JPY',
  'KRW',
  'LKR',
  'NPR',
] as const;

/**
 * The group currency is the unit every pinned trip rate converts into. Changing
 * it while any rate is pinned would silently reinterpret every stored numerator
 * and denominator as a rate into a different currency. That is the same class of
 * ledger lie as changing it after expenses exist, so the row becomes read-only
 * once either facts or rates depend on it. A recorded settlement counts too: the
 * server freezes the currency on any of the three (`waves_guard_group_columns`,
 * CURRENCY_LOCKED), and this mirrors it so the control never offers a change the
 * server will refuse.
 */
export function settlementCurrencyLocked(
  expenseCount: number,
  tripRateCount: number,
  settlementCount = 0,
): boolean {
  return expenseCount > 0 || tripRateCount > 0 || settlementCount > 0;
}

/** Only an admin can pick the settlement currency, and only before anything
 *  else has made that currency part of the group's arithmetic. */
export function canEditSettlementCurrency(
  isAdmin: boolean,
  expenseCount: number,
  tripRateCount: number,
  settlementCount = 0,
): boolean {
  return isAdmin && !settlementCurrencyLocked(expenseCount, tripRateCount, settlementCount);
}
