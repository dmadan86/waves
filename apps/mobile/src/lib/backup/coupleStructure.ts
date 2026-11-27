import type { BackupCouple } from './payload';

export interface CoupleStructure {
  groups: number;
  records: number;
  tombstones: number;
  byGroup: Record<
    string,
    { records: number; tombstones: number; recordIds: string[]; tombstoneIds: string[] }
  >;
}

/** Count the decoded state shape; the serialized byte/character length has no data meaning. */
export function coupleStructure(couple: readonly BackupCouple[]): CoupleStructure {
  const byGroup: CoupleStructure['byGroup'] = {};
  let records = 0;
  let tombstones = 0;
  for (const entry of couple) {
    const state = JSON.parse(entry.records) as unknown;
    if (!Array.isArray(state)) throw new Error('invalid couple backup structure');
    const dead = state.filter((row) => !!row && typeof row === 'object' && 'deleted' in row).length;
    const tombstoneIds = state
      .filter((row) => !!row && typeof row === 'object' && 'deleted' in row)
      .map((row) => String((row as { id?: unknown }).id ?? ''));
    const recordIds = state
      .filter((row) => !!row && typeof row === 'object' && !('deleted' in row))
      .map((row) => String((row as { id?: unknown }).id ?? ''));
    const key = entry.former ? `former:${entry.groupId}` : entry.groupId;
    byGroup[key] = { records: state.length, tombstones: dead, recordIds, tombstoneIds };
    records += state.length;
    tombstones += dead;
  }
  return { groups: couple.length, records, tombstones, byGroup };
}

export function losesCoupleData(existing: CoupleStructure, local: CoupleStructure): boolean {
  return (
    existing.groups > local.groups ||
    Object.entries(existing.byGroup).some(([id, old]) => {
      const current = local.byGroup[id];
      return (
        !current ||
        old.recordIds.some((recordId) => !current.recordIds.includes(recordId)) ||
        old.tombstoneIds.some((tombstoneId) => !current.tombstoneIds.includes(tombstoneId))
      );
    })
  );
}
