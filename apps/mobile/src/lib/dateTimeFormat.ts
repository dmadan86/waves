/**
 * A shared `Intl.DateTimeFormat` per (locale, options).
 *
 * Building one resolves the locale's calendar data and costs far more than
 * formatting a date with it; a list that labels every day header or row with a
 * fresh formatter pays that price per row, per render. Formatters are
 * immutable, so one per key is safe to share. The keys are the handful of
 * option shapes the screens use times the reader's locale, so the map needs no
 * eviction. A construction that throws (an unsupported locale on a stripped
 * Intl) is not cached and throws again, so callers' fallbacks still run.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

export function dateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter;
}
