/**
 * The day an expense is filed under, as the three conversions a form needs.
 *
 * The ledger stores a plain UTC day with no time (`YYYY-MM-DD`), a date picker
 * wants a `Date`, and a person wants to read "Tue, 9 Sep". These lived inside
 * the capture screen until the expense form grew a date picker of its own; a
 * second copy is how the two screens would have drifted into disagreeing about
 * what "the same day" means.
 */

/**
 * Parsed as local noon rather than midnight: a date-only string turned into
 * midnight UTC lands on the previous day west of Greenwich (the same trap
 * TripDates avoids).
 */
export function dateFrom(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1, 12);
}

/** The picker's answer, back as the day the ledger stores. */
export function isoDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/** The same day, said in the reader's language. */
export function showDate(iso: string, locale: string): string {
  return dateFrom(iso).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
