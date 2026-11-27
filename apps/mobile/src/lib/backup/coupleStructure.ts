import type { BackupCouple } from './payload';

export interface CoupleStructure {
  groups: number;
  records: number;
  tombstones: number;
  byGroup: Record<string, { records: number; tombstones: number }>;
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
    byGroup[entry.groupId] = { records: state.length, tombstones: dead };
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
      return !current || current.records < old.records || current.tombstones < old.tombstones;
    })
  );
}
