import { coupleStructure } from './coupleStructure';
import type { BackupCouple } from './payload';

/** Tombstones are backup data too: they prevent deleted rentals from returning. */
export function hasCoupleBackupData(entries: readonly BackupCouple[]): boolean {
  const structure = coupleStructure(entries);
  return structure.records + structure.tombstones > 0;
}
