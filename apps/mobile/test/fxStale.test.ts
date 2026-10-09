/**
 * A rate from another day is never applied without asking (lib/fxStale.ts).
 *
 * Pinned: a stale reply is split from the record that would be stored (no
 * `stale`/`day` ever reaches `expense_versions.fx`), and one without a real
 * day is invalid, never "Rate from "; the label names the rate's own day in
 * the reader's language without a timezone shift; the backfill puts a fresh
 * rate on a bill, but one from another day only once the person accepted
 * them; and a run where every bill was skipped for one says so without a
 * "done" headline.
 */

import { describe, expect, it } from 'vitest';

import type { FxRecord } from '@waves/core';

import {
  StaleFxRateError,
  backfillOutcome,
  lookupFromError,
  oldestDay,
  readFxReply,
  staleLabel,
  usableRate,
} from '../src/lib/fxStale';

const record: FxRecord = {
  num: '33647',
  den: '10000000',
  from: 'VND',
  to: 'INR',
  ts: '2026-10-05T00:00:00.000Z',
  source: 'currency-api',
};

describe('readFxReply', () => {
  it('passes a fresh reply through untouched', () => {
    expect(readFxReply(record)).toEqual({ kind: 'fresh', record });
  });

  it('splits a stale reply into the record and its day', () => {
    expect(readFxReply({ ...record, stale: true, day: '2026-10-05' })).toEqual({
      kind: 'stale',
      record,
      day: '2026-10-05',
    });
  });

  it('a stale reply without a usable day is invalid, never a guess', () => {
    for (const day of [undefined, '', 'someday', '2026-13-45', 20261005, null]) {
      expect(readFxReply({ ...record, stale: true, day })).toEqual({ kind: 'invalid' });
    }
  });

  it('treats anything but stale === true as fresh', () => {
    expect(readFxReply({ ...record, stale: 'yes' }).kind).toBe('fresh');
  });
});

describe('staleLabel', () => {
  it('says the rate’s own day, with no timezone shift', () => {
    expect(staleLabel('2026-10-05', 'Rate from {date}', 'en-GB')).toBe('Rate from 5 Oct');
    expect(staleLabel('2026-01-01', 'Rate from {date}', 'en-US')).toBe('Rate from Jan 1');
  });

  it('shows an unreadable day as it came', () => {
    expect(staleLabel('someday', 'Rate from {date}')).toBe('Rate from someday');
  });
});

describe('the backfill and older rates', () => {
  it('a fresh rate is always used', () => {
    expect(usableRate({ kind: 'fresh', record }, false)).toBe(record);
  });

  it('an older rate is skipped unless the person accepted older rates', () => {
    const stale = lookupFromError(new StaleFxRateError(record, '2026-10-05'));
    expect(stale).toEqual({ kind: 'stale', record, day: '2026-10-05' });
    expect(usableRate(stale, false)).toBeNull();
    expect(usableRate(stale, true)).toBe(record);
  });

  it('any other failure gives nothing, accepted or not', () => {
    const none = lookupFromError(new Error('offline'));
    expect(none).toEqual({ kind: 'none' });
    expect(usableRate(none, true)).toBeNull();
  });

  it('a run where every bill was skipped for another day’s rate has no "done" headline', () => {
    expect(
      backfillOutcome({ updated: 0, failed: 0, staleDays: ['2026-10-05', '2026-10-01'] }),
    ).toEqual({
      headline: null,
      allDone: false,
      onlyStale: true,
      staleCount: 2,
      staleFrom: '2026-10-01',
    });
  });

  it('a mixed run keeps its headline and adds the explanation', () => {
    expect(backfillOutcome({ updated: 3, failed: 0, staleDays: ['2026-10-05'] })).toMatchObject({
      headline: 'done',
      allDone: false,
      onlyStale: false,
    });
    expect(backfillOutcome({ updated: 0, failed: 1, staleDays: ['2026-10-05'] })).toMatchObject({
      headline: 'partial',
      onlyStale: false,
    });
    expect(backfillOutcome({ updated: 2, failed: 0, staleDays: [] })).toEqual({
      headline: 'done',
      allDone: true,
      onlyStale: false,
      staleCount: 0,
      staleFrom: null,
    });
  });

  it('names the oldest day a run skipped', () => {
    expect(oldestDay(['2026-10-05', '2026-09-30', '2026-10-01'])).toBe('2026-09-30');
    expect(oldestDay([])).toBeNull();
  });
});
