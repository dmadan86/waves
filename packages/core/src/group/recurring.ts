/**
 * Recurring GROUP expenses — the monthly rent in a flat group.
 *
 * Everything here is pure: `today` and every date arrive as arguments, nothing
 * reads a clock, and there is no state between calls. The same arithmetic runs in
 * three places — the phone (to show "next: 1 Nov" and to preview), the server
 * generator (`waves_generate_recurring_expenses`, which has a SQL twin of
 * {@link nextOccurrenceAfter} pinned against these cases by a db test) and the
 * tests — so it is kept small enough to be mirrored line for line.
 *
 * Reuse, not duplication: the calendar arithmetic is the personal ledger's own
 * (`addToDate` clamps a day to the month it lands in, `stepOccurrence` walks a
 * twice-a-month rule, `scheduleFor` / `frequencyOf` name the patterns). What this
 * adds is **anchor memory**. The personal ledger steps from the previous date, so
 * a rule on the 31st goes 31 -> 28 -> 28 forever after February. A rent due on
 * the 31st must come back to the 31st. Every group occurrence is therefore
 * computed from the anchor (`anchor + k * interval`), never from the last date.
 */

import { dayDelta, addToDate, stepOccurrence } from '../personal/compute';
import type { Cadence } from '../personal/types';
import { computeShares } from '../split/computeShares';
import { parseSplitParams, serialiseSplitParams } from '../split/wire';
import type {
  GroupRecurringCreatePayload,
  GroupRecurringLine,
  GroupRecurringPatch,
} from '../sync/protocol';
import { Frequency, scheduleFor } from '../personal/frequency';
import type { SplitParams } from '../split/types';

export type GroupRecurringStatus = 'active' | 'paused' | 'stopped';

/** The part of a rule that decides its dates. */
export interface GroupSchedule {
  readonly cadence: Cadence;
  readonly interval: number;
  /** Only `semimonthly` reads it. */
  readonly secondDay: number | null;
  /** The first occurrence; also the day-of-month every later one remembers. */
  readonly anchorDate: string;
}

/** A rule as the app holds it (decoded from a `group_recurring_expenses` row). */
export interface GroupRecurringRule extends GroupSchedule {
  readonly id: string;
  readonly groupId: string;
  /** The member the generated expenses are recorded as written by. */
  readonly createdBy: string;
  readonly description: string;
  readonly category: string | null;
  readonly currency: string;
  readonly amount: bigint;
  readonly splitParams: SplitParams;
  readonly participants: readonly string[];
  /** Who paid, in minor units; sums to `amount`. */
  readonly payers: Readonly<Record<string, bigint>>;
  readonly notes: string | null;
  /** The next date an expense is due. */
  readonly nextDate: string;
  readonly endDate: string | null;
  readonly status: GroupRecurringStatus;
  readonly lastGeneratedOn: string | null;
}

/** Most occurrences one run will create for one rule. The remainder follows on
 *  the next run (the server runs hourly, the app on every open), oldest first,
 *  so nothing is dropped and a long-forgotten rule never floods a group at once. */
export const RECURRING_CATCH_UP_CAP = 12;

function stepsFor(schedule: GroupSchedule): { cadence: Cadence; step: number } {
  const interval = schedule.interval > 0 ? Math.floor(schedule.interval) : 1;
  return { cadence: schedule.cadence, step: interval };
}

/** A real calendar date (not 2026-02-30 or 2026-13-01). */
export function isRealDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.toISOString().slice(0, 10) === date;
}

/** Months from `a` to `b` (YYYY-MM-DD), by calendar month, ignoring the day. */
function monthsBetween(a: string, b: string): number {
  return (
    (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
    (Number(b.slice(5, 7)) - Number(a.slice(5, 7)))
  );
}

/**
 * The k-th occurrence (k = 0 is the anchor), computed from the anchor so a
 * month-end day is remembered. Not defined for `semimonthly`, which is walked
 * by {@link nextOccurrenceAfter}.
 */
function occurrence(schedule: GroupSchedule, k: number): string {
  if (k <= 0) return schedule.anchorDate; // addToDate reads 0 as 1
  const { cadence, step } = stepsFor(schedule);
  return addToDate(schedule.anchorDate, cadence, step * k);
}

/**
 * The first occurrence strictly after `after`. A date before the anchor gives
 * the anchor. Malformed input comes back unchanged (never throws).
 */
export function nextOccurrenceAfter(schedule: GroupSchedule, after: string): string {
  if (!isRealDate(after) || !isRealDate(schedule.anchorDate)) return after;
  if (after < schedule.anchorDate) return schedule.anchorDate;
  if (schedule.cadence === 'semimonthly') {
    return schedule.secondDay === null
      ? addToDate(after, 'monthly', 1)
      : stepOccurrence(schedule, after);
  }
  const { cadence, step } = stepsFor(schedule);
  // Start one period early so the clamped short-month dates cannot overshoot,
  // then walk forward; at most two or three iterations.
  const estimate =
    cadence === 'weekly'
      ? Math.floor(dayDelta(schedule.anchorDate, after) / (7 * step))
      : Math.floor(
          monthsBetween(schedule.anchorDate, after) / (cadence === 'yearly' ? 12 * step : step),
        );
  let k = Math.max(0, estimate - 1);
  while (occurrence(schedule, k) <= after) k += 1;
  return occurrence(schedule, k);
}

/** The first occurrence on or after `date` (the anchor if `date` is earlier). */
export function firstOccurrenceOnOrAfter(schedule: GroupSchedule, date: string): string {
  if (date <= schedule.anchorDate) return schedule.anchorDate;
  return nextOccurrenceAfter(schedule, dayBefore(date));
}

function dayBefore(date: string): string {
  const t = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) - 1),
  );
  return t.toISOString().slice(0, 10);
}

export interface DueRun {
  /** Occurrence dates owed, oldest first, at most `cap`. */
  readonly dates: readonly string[];
  /** Where `nextDate` lands after those are created. */
  readonly nextDate: string;
  /** True when the rule has run past its `endDate` and should become `stopped`. */
  readonly ended: boolean;
}

/**
 * Every occurrence a rule owes up to and including `today` (RC-11: an `endDate`
 * equal to the occurrence still fires, one day earlier does not), capped.
 * A paused or stopped rule owes nothing.
 */
export function dueOccurrences(
  rule: Pick<GroupRecurringRule, keyof GroupSchedule | 'nextDate' | 'endDate' | 'status'>,
  today: string,
  cap: number = RECURRING_CATCH_UP_CAP,
): DueRun {
  if (rule.status !== 'active') return { dates: [], nextDate: rule.nextDate, ended: false };
  const dates: string[] = [];
  let cursor = rule.nextDate;
  while (cursor <= today && dates.length < cap) {
    if (rule.endDate !== null && cursor > rule.endDate) break;
    dates.push(cursor);
    const next = nextOccurrenceAfter(rule, cursor);
    if (next <= cursor) break; // malformed schedule: never loop
    cursor = next;
  }
  const ended = rule.endDate !== null && cursor > rule.endDate;
  return { dates, nextDate: cursor, ended };
}

/** Whether the rule has an occurrence waiting on `today`. */
export function isGroupRecurringDue(
  rule: Pick<GroupRecurringRule, 'status' | 'nextDate' | 'endDate'>,
  today: string,
): boolean {
  if (rule.status !== 'active') return false;
  if (rule.endDate !== null && rule.nextDate > rule.endDate) return false;
  return rule.nextDate <= today;
}

/**
 * Where a rule's `nextDate` goes when it is resumed or its schedule is edited:
 * the first occurrence on or after today. Time spent paused is never back-paid.
 */
export function resumeNextDate(schedule: GroupSchedule, today: string): string {
  return firstOccurrenceOnOrAfter(schedule, today);
}

/** Which transitions a status allows: stopped is final. */
export function canChangeRecurringStatus(
  from: GroupRecurringStatus,
  to: GroupRecurringStatus,
): boolean {
  if (from === to) return true;
  if (from === 'stopped') return false;
  return true;
}

// ───────────────────────────────────────────────────────── row decode ──

/** The wire row (snake_case, amounts as strings) a pull or the overlay carries. */
export interface GroupRecurringRowLike {
  readonly id: string;
  readonly group_id: string;
  readonly created_by: string;
  readonly description: string;
  readonly category: string | null;
  readonly currency: string;
  readonly amount: string;
  readonly split_params: unknown;
  readonly payers: readonly { readonly memberId: string; readonly amount: string }[];
  readonly shares: readonly { readonly memberId: string; readonly amount: string }[];
  readonly notes: string | null;
  readonly cadence: Cadence;
  readonly interval: number;
  readonly second_day: number | null;
  readonly anchor_date: string;
  readonly next_date: string;
  readonly end_date: string | null;
  readonly status: GroupRecurringStatus;
  readonly last_generated_on: string | null;
}

/** A row as the rule the app works with. */
export function groupRecurringFromRow(row: GroupRecurringRowLike): GroupRecurringRule {
  const payers: Record<string, bigint> = {};
  for (const line of row.payers ?? []) payers[line.memberId] = BigInt(line.amount);
  return {
    id: row.id,
    groupId: row.group_id,
    createdBy: row.created_by,
    description: row.description,
    category: row.category,
    currency: row.currency,
    amount: BigInt(row.amount),
    splitParams: parseSplitParams(row.split_params),
    participants: (row.shares ?? []).map((line) => line.memberId),
    payers,
    notes: row.notes,
    cadence: row.cadence,
    interval: row.interval,
    secondDay: row.second_day,
    anchorDate: row.anchor_date,
    nextDate: row.next_date,
    endDate: row.end_date,
    status: row.status,
    lastGeneratedOn: row.last_generated_on,
  };
}

// ─────────────────────────────────────────────── building the payloads ──

/** The expense a rule repeats, as the add-expense form holds it. */
export interface GroupRecurringTemplate {
  readonly description: string;
  readonly category?: string | null;
  readonly currency: string;
  readonly amount: bigint;
  readonly splitParams: SplitParams;
  readonly participants: readonly string[];
  /** Who paid, in minor units; must sum to `amount`. */
  readonly payers: Readonly<Record<string, bigint>>;
  readonly notes?: string | null;
}

export interface GroupRecurringWhen {
  readonly frequency: Frequency;
  /** Only for `EveryNMonths`. */
  readonly interval?: number;
  /** Only for `TwiceAMonth`. */
  readonly secondDay?: number | null;
  readonly anchorDate: string;
  readonly endDate?: string | null;
  /** True when the first occurrence is the expense being saved right now. */
  readonly skipFirst?: boolean;
}

function lines(
  map: ReadonlyMap<string, bigint> | Readonly<Record<string, bigint>>,
): GroupRecurringLine[] {
  const entries = map instanceof Map ? [...map.entries()] : Object.entries(map);
  return entries.map(([memberId, amount]) => ({ memberId, amount: amount.toString() }));
}

/**
 * The template as the two lists the server stores. The shares are computed here,
 * once, with the rule's id as the rounding seed, so a rule split three ways
 * always rounds the same way; the server only checks they add up.
 */
export function templateLines(
  template: GroupRecurringTemplate,
  seed: string,
): { payers: GroupRecurringLine[]; shares: GroupRecurringLine[] } {
  const paid = Object.values(template.payers).reduce((total, value) => total + value, 0n);
  if (paid !== template.amount) {
    throw new Error(`Payers add up to ${paid} but the expense is ${template.amount}`);
  }
  const shares = computeShares({
    amount: template.amount,
    currency: template.currency,
    params: template.splitParams,
    participants: [...template.participants],
    seed,
  });
  return { payers: lines(template.payers), shares: lines(shares) };
}

export function buildGroupRecurringCreate(
  ruleId: string,
  template: GroupRecurringTemplate,
  when: GroupRecurringWhen,
): GroupRecurringCreatePayload {
  const schedule = scheduleFor(when.frequency, {
    interval: when.interval,
    secondDay: when.secondDay,
  });
  const { payers, shares } = templateLines(template, ruleId);
  return {
    ruleId,
    description: template.description.trim(),
    category: template.category ?? null,
    currency: template.currency,
    amount: template.amount.toString(),
    splitType: template.splitParams.kind,
    splitParams: serialiseSplitParams(template.splitParams),
    payers,
    shares,
    notes: template.notes?.trim() || null,
    cadence: schedule.cadence,
    interval: schedule.interval,
    secondDay: schedule.secondDay,
    anchorDate: when.anchorDate,
    endDate: when.endDate ?? null,
    skipFirst: when.skipFirst ?? false,
  };
}

/** An edit of the expense a rule repeats (amount, split, who paid, wording). */
export function templatePatch(
  ruleId: string,
  template: GroupRecurringTemplate,
): GroupRecurringPatch {
  const { payers, shares } = templateLines(template, ruleId);
  return {
    description: template.description.trim(),
    category: template.category ?? null,
    currency: template.currency,
    amount: template.amount.toString(),
    split_type: template.splitParams.kind,
    split_params: serialiseSplitParams(template.splitParams),
    payers,
    shares,
    notes: template.notes?.trim() || null,
  };
}

/** An edit of when a rule repeats. */
export function schedulePatch(when: GroupRecurringWhen): GroupRecurringPatch {
  const schedule = scheduleFor(when.frequency, {
    interval: when.interval,
    secondDay: when.secondDay,
  });
  return {
    cadence: schedule.cadence,
    interval: schedule.interval,
    second_day: schedule.secondDay,
    anchor_date: when.anchorDate,
    end_date: when.endDate ?? null,
  };
}

/** Split kinds whose shares follow the amount, so the amount may be edited. An
 *  exact or adjusted split names its own amounts and would no longer add up. */
export function canEditRecurringAmount(rule: Pick<GroupRecurringRule, 'splitParams'>): boolean {
  const kind = rule.splitParams.kind;
  return kind === 'equal' || kind === 'percent' || kind === 'shares';
}

/**
 * Who paid, scaled to a new amount: a single payer pays all of it; several keep
 * their proportions, the rounding remainder going to the largest payer so the
 * total is exact.
 */
export function rescalePayers(
  payers: Readonly<Record<string, bigint>>,
  amount: bigint,
): Record<string, bigint> {
  const entries = Object.entries(payers).filter(([, value]) => value > 0n);
  const old = entries.reduce((total, [, value]) => total + value, 0n);
  if (entries.length === 0 || old === 0n) return { ...payers };
  const out: Record<string, bigint> = {};
  let given = 0n;
  for (const [id, value] of entries) {
    out[id] = (value * amount) / old;
    given += out[id]!;
  }
  const largest = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  out[largest] = out[largest]! + (amount - given);
  return out;
}

/** What a rule's edit sheet can change today: the wording and the amount. */
export interface GroupRecurringEdit {
  readonly description: string;
  readonly amount: bigint;
}

/**
 * The patch for an edit, or null when nothing changed (or the edit cannot be
 * made: an empty name, a zero amount, or an amount on a split that names its own
 * amounts). Payers are scaled and the shares recomputed, so the stored expense
 * still adds up.
 */
export function recurringEditPatch(
  rule: GroupRecurringRule,
  edit: GroupRecurringEdit,
): GroupRecurringPatch | null {
  const description = edit.description.trim();
  if (description === '' || edit.amount <= 0n) return null;
  const amountChanged = edit.amount !== rule.amount;
  if (amountChanged && !canEditRecurringAmount(rule)) return null;
  if (!amountChanged && description === rule.description) return null;
  return templatePatch(rule.id, {
    description,
    category: rule.category,
    currency: rule.currency,
    amount: edit.amount,
    splitParams: rule.splitParams,
    participants: rule.participants,
    payers: amountChanged ? rescalePayers(rule.payers, edit.amount) : rule.payers,
    notes: rule.notes,
  });
}

/** How the list shows a rule: running, paused, or over (stopped or past its end). */
export function recurringDisplayStatus(
  rule: Pick<GroupRecurringRule, 'status' | 'nextDate' | 'endDate'>,
): 'active' | 'paused' | 'ended' {
  if (rule.status === 'stopped') return 'ended';
  if (rule.endDate !== null && rule.nextDate > rule.endDate) return 'ended';
  return rule.status;
}
