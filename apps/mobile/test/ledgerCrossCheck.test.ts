import { describe, expect, it } from 'vitest';

import { isCrossCheckComparable, type CrossCheckTiming } from '../src/data/crossCheck';

/** A group sitting still: nothing queued, nothing in flight, server snapshot
 *  taken after the last sync. The only state in which the two computations are
 *  describing the same moment. */
const settled: CrossCheckTiming = {
  queuedHere: false,
  syncing: false,
  fetching: false,
  fetchedAt: 2_000,
  syncedAt: 1_000,
};

describe('balance cross-check timing', () => {
  it('compares a group that is standing still', () => {
    expect(isCrossCheckComparable(settled)).toBe(true);
  });

  it('holds off while this group still has queued work', () => {
    // The server has not been told yet, so of course it disagrees. This covers
    // the queued settlement too — the case the old expense-only `pending` flag
    // could not see.
    expect(isCrossCheckComparable({ ...settled, queuedHere: true })).toBe(false);
  });

  it('holds off mid-sync and mid-fetch', () => {
    expect(isCrossCheckComparable({ ...settled, syncing: true })).toBe(false);
    expect(isCrossCheckComparable({ ...settled, fetching: true })).toBe(false);
  });

  it('holds off when no server snapshot has arrived', () => {
    expect(isCrossCheckComparable({ ...settled, fetchedAt: 0 })).toBe(false);
  });

  it('rejects a snapshot older than the sync that changed the ledger', () => {
    // The false alarm in the wild: `invalidateGroup` fired the flush and the
    // refetch together, so the answer described the moment before the expense
    // it was meant to check.
    expect(isCrossCheckComparable({ ...settled, fetchedAt: 999, syncedAt: 1_000 })).toBe(false);
    // Fetched in the same millisecond as the sync completing still counts.
    expect(isCrossCheckComparable({ ...settled, fetchedAt: 1_000, syncedAt: 1_000 })).toBe(true);
  });

  it('compares a group that has never synced', () => {
    expect(isCrossCheckComparable({ ...settled, syncedAt: 0 })).toBe(true);
  });
});
