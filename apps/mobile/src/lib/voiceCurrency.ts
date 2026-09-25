/**
 * Which currency a spoken expense is saved in.
 *
 * "200 dollars for petrol" filed into a rupee group used to be written in the
 * group's currency with the same number: $200 became ₹200, a different amount
 * altogether. A group takes an expense in any currency (ADR-004 keeps balances
 * per currency), so the currency somebody said is the one that is saved. Only
 * an expense with no currency heard falls back to the group's, then to the
 * reader's default.
 */
export function voiceSaveCurrency(
  spoken: string | null,
  groupCurrency: string | null,
  fallback: string,
): string {
  return spoken ?? groupCurrency ?? fallback;
}

/**
 * The currency for a group made from a spoken batch: the one currency the batch
 * named, if it named exactly one, else the reader's default. A trip started by
 * "200 dollars for petrol" is a dollar trip.
 */
export function voiceNewGroupCurrency(
  spoken: readonly (string | null)[],
  fallback: string,
): string {
  const named = new Set(spoken.filter((currency): currency is string => currency !== null));
  return named.size === 1 ? [...named][0]! : fallback;
}
