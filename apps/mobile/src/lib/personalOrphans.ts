import type { MirrorPersonalRecord } from '@waves/core';

/** Transactions are repaired only when a referenced parent is tombstoned.
 * Missing parents stay untouched because their sync row may still be arriving. */
export function orphanedPersonalTxnIds(records: readonly MirrorPersonalRecord[]): string[] {
  const deleted = new Set(
    records
      .filter((record) => record.deleted_at !== null)
      .map((record) => `${record.record_kind}:${record.id}`),
  );
  return records
    .filter((record) => record.deleted_at === null && record.record_kind === 'txn')
    .filter((record) => {
      const d = record.data;
      return (
        (typeof d.investmentId === 'string' && deleted.has(`investment:${d.investmentId}`)) ||
        (typeof d.propertyId === 'string' && deleted.has(`property:${d.propertyId}`)) ||
        (typeof d.loanId === 'string' && deleted.has(`loan:${d.loanId}`))
      );
    })
    .map((record) => record.id);
}

const requested = new Set<string>();

/**
 * The orphan ids not already sent for deletion this session. The ledger hook is mounted by many
 * screens at once; without this each would queue the same delete.
 */
export function claimOrphanDeletes(ids: readonly string[]): string[] {
  const fresh = ids.filter((id) => !requested.has(id));
  for (const id of fresh) requested.add(id);
  return fresh;
}

/** Release a claim when its delete could not be queued, so the ledger can retry. */
export function releaseOrphanDelete(id: string): void {
  requested.delete(id);
}

/** Test-only: forget what was claimed. */
export function resetOrphanClaims(): void {
  requested.clear();
}
