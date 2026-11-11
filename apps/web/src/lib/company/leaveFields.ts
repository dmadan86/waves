/** Pure helpers for the leave-policy form (kept apart from the hooks so they test without the sync client). */

/** 1, 1.5, 0.5 ... without a trailing .0 */
export const daysText = (n: number): string => String(Math.round(n * 100) / 100);

/** A limit field: empty = no limit (null), a valid 0-366 number, or undefined when it is not valid. */
export function parseLimit(s: string): number | null | undefined {
  const v = s.trim();
  if (v === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 366 ? n : undefined;
}

/** Accrual per month: 0 to 5 in halves or quarters. */
export const validAccrual = (a: number | null | undefined): a is number =>
  a !== undefined && a !== null && a <= 5 && (a * 4) % 1 === 0;
