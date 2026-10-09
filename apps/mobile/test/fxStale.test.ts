/**
 * An older rate is never applied without asking (lib/fxStale.ts).
 *
 * Pinned: a stale reply is split from the record that would be stored (no
 * `stale`/`day` ever reaches `expense_versions.fx`); the label names the rate's
 * own day in the reader's language without a timezone shift; and the backfill
 * puts a fresh rate on a bill, but an older one only once the person accepted
 * older rates.
 */

import { describe, expect, it } from 'vitest';

import type { FxRecord } from '@waves/core';

import {
  StaleFxRateError,
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
    expect(readFxReply(record)).toEqual({ record, staleDay: null });
  });

  it('splits a stale reply into the record and its day', () => {
    expect(readFxReply({ ...record, stale: true, day: '2026-10-05' })).toEqual({
      record,
      staleDay: '2026-10-05',
    });
  });

  it('falls back to the record’s own day when the server sent none', () => {
    expect(readFxReply({ ...record, stale: true }).staleDay).toBe('2026-10-05');
  });

  it('treats anything but stale === true as fresh', () => {
    expect(readFxReply({ ...record, stale: 'yes' }).staleDay).toBeNull();
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

  it('names the oldest day a run skipped', () => {
    expect(oldestDay(['2026-10-05', '2026-09-30', '2026-10-01'])).toBe('2026-09-30');
    expect(oldestDay([])).toBeNull();
  });
});
