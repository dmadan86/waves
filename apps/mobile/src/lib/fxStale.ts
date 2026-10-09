/**
 * A rate from another day is never applied without asking.
 *
 * `fx-rate` can answer with a rate that is not the asked-for day's, flagged
 * `stale: true` with the `day` it is for: when every provider is down (the
 * cached rate nearest the day — usually older, newer only when nothing older
 * exists), or for a past bill only a latest-only source had (today's). That
 * number is still useful — a trip's rate barely moves in a few days — but only
 * the person can decide it is good enough, so the app shows "Rate from {date}"
 * with Use and Retry, and the missing-rates backfill skips such bills unless
 * the person explicitly accepts rates from other days.
 *
 * Pure and React-Native-free, so it is tested directly (test/fxStale.test.ts).
 */

import type { FxRecord } from '@waves/core';

/**
 * Thrown by `fetchFxRate` for a stale answer, so no caller can put one on a
 * bill by accident: a screen that has not been taught to ask simply sees a
 * failed fetch. The ones that ask catch this and offer `record`.
 */
export class StaleFxRateError extends Error {
  constructor(
    readonly record: FxRecord,
    /** The day the rate is for (YYYY-MM-DD). */
    readonly day: string,
  ) {
    super('Only a rate from another day is available just now');
    this.name = 'StaleFxRateError';
  }
}

/** The function's reply, read. */
export type FxReply =
  | { kind: 'fresh'; record: FxRecord }
  | { kind: 'stale'; record: FxRecord; day: string }
  /** Stale with no real day: it could only be shown as "Rate from ", so it is an error. */
  | { kind: 'invalid' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as YYYY-MM-DD. */
export function isDay(value: unknown): value is string {
  return typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * The function's reply split into the record to store and its staleness.
 *
 * `stale` and `day` never reach the stored record: `expense_versions.fx` is
 * the six fields of `FxRecord` and nothing else. A stale reply must say which
 * day it is for; one that does not is invalid, never a guess.
 */
export function readFxReply(data: unknown): FxReply {
  const { stale, day, ...record } = (data ?? {}) as FxRecord & { stale?: unknown; day?: unknown };
  if (stale !== true) return { kind: 'fresh', record: record as FxRecord };
  return isDay(day) ? { kind: 'stale', record: record as FxRecord, day } : { kind: 'invalid' };
}

/** "Rate from 5 Oct": the day a rate from another day is for, in the reader's language. */
export function staleLabel(day: string, template: string, locale?: string): string {
  const when = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  const text = Number.isNaN(when.getTime())
    ? day
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
        when,
      );
  return template.replace('{date}', text);
}

/** One lookup in a backfill: a fresh rate, one from another day on offer, or nothing. */
export type BackfillLookup =
  | { kind: 'fresh'; record: FxRecord }
  | { kind: 'stale'; record: FxRecord; day: string }
  | { kind: 'none' };

/** What a backfill lookup turns a thrown fetch into. */
export function lookupFromError(caught: unknown): BackfillLookup {
  return caught instanceof StaleFxRateError
    ? { kind: 'stale', record: caught.record, day: caught.day }
    : { kind: 'none' };
}

/**
 * The fetched rate a backfill may put on a bill: a fresh one always, one from
 * another day only once the person has said "use rates from other days".
 */
export function usableRate(lookup: BackfillLookup, acceptStale: boolean): FxRecord | null {
  if (lookup.kind === 'fresh') return lookup.record;
  if (lookup.kind === 'stale' && acceptStale) return lookup.record;
  return null;
}

/** The earliest day among the rates a run skipped, for "a rate from another day (…)". */
export function oldestDay(days: readonly string[]): string | null {
  return days.length ? [...days].sort()[0]! : null;
}

/** What a missing-rates run had to report once it finished. */
export interface BackfillTally {
  readonly updated: number;
  readonly failed: number;
  /** One day per bill skipped because only a rate from another day was on offer. */
  readonly staleDays: readonly string[];
}

/**
 * How the missing-rates card reads after a run.
 *
 * `onlyStale`: every bill it looked at was skipped for a rate from another
 * day. Then nothing was done, so there is no "done" headline — only the
 * explanation, "Use rates from other days" and Retry.
 */
export function backfillOutcome(tally: BackfillTally): {
  headline: 'done' | 'partial' | null;
  allDone: boolean;
  onlyStale: boolean;
  staleCount: number;
  staleFrom: string | null;
} {
  const staleCount = tally.staleDays.length;
  const onlyStale = staleCount > 0 && tally.updated === 0 && tally.failed === 0;
  return {
    headline: onlyStale ? null : tally.failed > 0 ? 'partial' : 'done',
    allDone: tally.failed === 0 && staleCount === 0,
    onlyStale,
    staleCount,
    staleFrom: oldestDay(tally.staleDays),
  };
}
