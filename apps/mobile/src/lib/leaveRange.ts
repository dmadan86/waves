/** Pure rules for the leave request calendar and the "Upcoming time off" lists. Days are ISO `YYYY-MM-DD`. */

import { leaveDays } from '@waves/core';

export type Picking = 'start' | 'end';
export interface RangeSel {
  readonly start: string;
  readonly end: string;
  /** Which end the next tap sets. */
  readonly picking: Picking;
}

export const shiftDay = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The window a request may fall in: 60 days back to a year ahead (same bound the sheet's error uses). */
export const isDayDisabled = (day: string, today: string): boolean =>
  day < shiftDay(today, -60) || day > shiftDay(today, 365);

/**
 * One tap on a day. Picking start: that day becomes the start (the end follows if it would sit before it).
 * Picking end: a day before the start restarts the range there; otherwise it sets the end.
 */
export function pickDay(sel: RangeSel, day: string): RangeSel {
  if (sel.picking === 'start') {
    return { start: day, end: sel.end < day ? day : sel.end, picking: 'end' };
  }
  if (day < sel.start) return { start: day, end: day, picking: 'end' };
  return { start: sel.start, end: day, picking: 'start' };
}

/** Same count the balance check uses (`leaveDays`): half a day only for a one-day range. */
export const selectedDays = (sel: Pick<RangeSel, 'start' | 'end'>, half: boolean): number =>
  sel.end < sel.start
    ? 0
    : leaveDays({ startDay: sel.start, endDay: sel.end, halfDay: half && sel.start === sel.end });

interface Span {
  readonly startDay: string;
  readonly endDay: string;
}
/** Every day covered by the spans, clamped to [from, to], mapped to `value` (first span wins). */
export function markDays<T>(
  spans: readonly (Span & { value: T })[],
  from: string,
  to: string,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const s of spans) {
    for (
      let d = s.startDay < from ? from : s.startDay;
      d <= s.endDay && d <= to;
      d = shiftDay(d, 1)
    ) {
      if (!(d in out)) out[d] = s.value;
    }
  }
  return out;
}

interface LeaveLike extends Span {
  readonly id: string;
  readonly memberId: string;
  readonly status: 'pending' | 'approved' | 'rejected';
}
/** Leave still ahead (ends today or later), approved or pending, soonest first. Optionally one member, a horizon and a cap. */
export function upcomingLeave<L extends LeaveLike>(
  leave: readonly L[],
  today: string,
  opts: { memberId?: string | null; withinDays?: number; limit?: number } = {},
): L[] {
  const horizon = opts.withinDays === undefined ? null : shiftDay(today, opts.withinDays);
  const rows = leave
    .filter(
      (l) =>
        l.status !== 'rejected' &&
        l.endDay >= today &&
        (!opts.memberId || l.memberId === opts.memberId) &&
        (horizon === null || l.startDay <= horizon),
    )
    .sort((a, b) => a.startDay.localeCompare(b.startDay) || a.id.localeCompare(b.id));
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}
