/**
 * Whether a typed search matches an expense's amount.
 *
 * People search the ledger the way they remember a bill — "500", "1,050",
 * "283.33" — so a numeric query is compared against the amount written out
 * plainly (whole units, and whole units with the minor part), ignoring the
 * thousands separators and currency symbols a person might type.
 */
export function amountMatches(
  needle: string,
  amountMinor: bigint | number | string,
  minorDigits = 2,
): boolean {
  const typed = needle.replace(/[^\d.]/g, '');
  if (!typed || !/\d/.test(typed)) return false;
  let minor: bigint;
  try {
    minor = BigInt(amountMinor);
  } catch {
    return false;
  }
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const scale = 10n ** BigInt(minorDigits);
  const whole = (abs / scale).toString();
  const fraction = minorDigits > 0 ? (abs % scale).toString().padStart(minorDigits, '0') : '';
  const forms = fraction ? [whole, `${whole}.${fraction}`] : [whole];
  return forms.some((form) => form.startsWith(typed));
}
