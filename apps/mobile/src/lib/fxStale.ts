/**
 * An older rate is never applied without asking.
 *
 * When every rate provider is down, `fx-rate` answers with the newest rate it
 * has cached for the pair, flagged `stale: true` with the `day` it is for. That
 * number is still useful — a trip's rate barely moves in a few days — but only
 * the person can decide it is good enough, so the app shows "Rate from {date}"
 * with Use and Retry, and the missing-rates backfill skips such bills unless
 * the person explicitly accepts the older rates.
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
    super('Could not reach the exchange just now — only an older rate is available');
    this.name = 'StaleFxRateError';
  }
}

/**
 * The function's reply split into the record to store and its staleness.
 *
 * `stale` and `day` never reach the stored record: `expense_versions.fx` is
 * the six fields of `FxRecord` and nothing else.
 */
export function readFxReply(data: unknown): { record: FxRecord; staleDay: string | null } {
  const { stale, day, ...record } = (data ?? {}) as FxRecord & { stale?: unknown; day?: unknown };
  const staleDay =
    stale === true ? (typeof day === 'string' && day ? day : record.ts?.slice(0, 10) || '') : null;
  return { record: record as FxRecord, staleDay };
}

/** "Rate from 5 Oct": the day an older rate is for, in the reader's language. */
export function staleLabel(day: string, template: string, locale?: string): string {
  const when = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  const text = Number.isNaN(when.getTime())
    ? day
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
        when,
      );
  return template.replace('{date}', text);
}

/** One lookup in a backfill: a fresh rate, an older one on offer, or nothing. */
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
 * The fetched rate a backfill may put on a bill: a fresh one always, an older
 * one only once the person has said "use older rates".
 */
export function usableRate(lookup: BackfillLookup, acceptStale: boolean): FxRecord | null {
  if (lookup.kind === 'fresh') return lookup.record;
  if (lookup.kind === 'stale' && acceptStale) return lookup.record;
  return null;
}

/** The oldest of the older rates a run skipped, for "only an older rate (from …)". */
export function oldestDay(days: readonly string[]): string | null {
  return days.length ? [...days].sort()[0]! : null;
}
