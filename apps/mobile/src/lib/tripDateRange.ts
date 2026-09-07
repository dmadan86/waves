/**
 * Trip date range arithmetic, kept outside the component so the things a trip
 * depends on are testable without rendering React Native.
 *
 * These values land in `date` columns, not timestamp columns. Every conversion
 * therefore reads and writes the local calendar fields directly: a traveller in
 * Dubai picking 4 October must store `2026-10-04`, not whatever UTC thinks that
 * local evening is.
 */

export interface TripDateRangePatch {
  readonly start_date: string;
  readonly end_date: string;
  readonly time_zone: string;
}

/** Parsed as local noon rather than midnight, avoiding UTC/date-boundary drift. */
export function tripDateFromIso(iso: string | null): Date | null {
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12);
}

/** Serialize a local calendar day to the `YYYY-MM-DD` stored in date columns. */
export function tripDateToIso(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/** Whole trip days, inclusive of both endpoints. */
export function inclusiveTripDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/**
 * Build the saved patch from the two tapped dates. The order of taps does not
 * matter: the earlier day is always the stored start.
 */
export function tripDateRangePatch(a: Date, b: Date, timeZone: string): TripDateRangePatch {
  const [from, to] = a <= b ? [a, b] : [b, a];
  return {
    start_date: tripDateToIso(from),
    end_date: tripDateToIso(to),
    time_zone: timeZone,
  };
}
