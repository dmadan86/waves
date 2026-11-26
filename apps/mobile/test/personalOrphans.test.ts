import { beforeEach, describe, expect, it } from 'vitest';
import type { MirrorPersonalRecord } from '@waves/core';
import {
  claimOrphanDeletes,
  orphanedPersonalTxnIds,
  releaseOrphanDelete,
  resetOrphanClaims,
} from '../src/lib/personalOrphans';

const rec = (
  id: string,
  record_kind: string,
  data: Record<string, unknown> = {},
  deleted = false,
): MirrorPersonalRecord =>
  ({ id, record_kind, data, deleted_at: deleted ? '2026-11-20T00:00:00Z' : null }) as never;

describe('orphaned Personal entries from deletes made before the cascade fix', () => {
  beforeEach(() => resetOrphanClaims());

  it('deletes entries of a deleted investment, rental or loan — and nothing else', () => {
    const records = [
      rec('inv1', 'investment', {}, true),
      rec('prop1', 'property', {}, true),
      rec('loan1', 'loan', {}, true),
      rec('loan2', 'loan'),
      rec('t-inv', 'txn', { investmentId: 'inv1' }),
      rec('t-rent', 'txn', { propertyId: 'prop1' }),
      rec('t-emi', 'txn', { loanId: 'loan1' }),
      rec('t-live-loan', 'txn', { loanId: 'loan2' }),
      rec('t-unsynced-parent', 'txn', { loanId: 'not-here-yet' }),
      rec('t-plain', 'txn', {}),
      rec('t-already-gone', 'txn', { loanId: 'loan1' }, true),
    ];
    expect(orphanedPersonalTxnIds(records).sort()).toEqual(['t-emi', 't-inv', 't-rent']);
  });

  it('sends each delete once even when many screens see the same orphans', () => {
    expect(claimOrphanDeletes(['a', 'b'])).toEqual(['a', 'b']);
    expect(claimOrphanDeletes(['a', 'b'])).toEqual([]);
    expect(claimOrphanDeletes(['b', 'c'])).toEqual(['c']);
  });

  it('releases a failed dispatch so the orphan can be retried', () => {
    expect(claimOrphanDeletes(['a'])).toEqual(['a']);
    releaseOrphanDelete('a');
    expect(claimOrphanDeletes(['a'])).toEqual(['a']);
  });
});
