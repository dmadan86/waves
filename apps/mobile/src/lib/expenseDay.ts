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

/**
 * A day and a time of day, as one instant.
 *
 * The day is the ledger's `YYYY-MM-DD`; the time is the hours and minutes the
 * person sees on `time`'s own (local) clock. Both are read and written in local
 * components, never through UTC, so the answer is the wall-clock time they
 * picked on the day they picked whatever the phone's zone — and the instant it
 * gives back (`toISOString`) renders as that same time on this phone later.
 */
export function mergeDateAndTime(dayIso: string, time: Date): Date {
  const [year, month, day] = dayIso.split('-').map(Number);
  return new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1, time.getHours(), time.getMinutes());
}

/**
 * A chosen time carried onto another day, keeping its clock time. An instant
 * that is already on that (local) day is returned untouched, so a save that
 * moved nothing writes nothing new.
 */
export function moveTimeToDay(occurredAt: string | null, dayIso: string): string | null {
  if (!occurredAt) return null;
  const instant = new Date(occurredAt);
  if (Number.isNaN(instant.getTime())) return null;
  return isoDate(instant) === dayIso ? occurredAt : mergeDateAndTime(dayIso, instant).toISOString();
}

/** The clock time a picker should open on: the bill's own, else now rounded to 5 minutes. */
export function pickerTime(shownMs: number | null, nowMs: number): Date {
  if (shownMs != null) return new Date(shownMs);
  const step = 5 * 60 * 1000;
  return new Date(Math.round(nowMs / step) * step);
}

/** The time of day, said in the reader's language and clock. */
export function showTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}
