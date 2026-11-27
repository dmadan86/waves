/**
 * The pure half of the Groups list's two parts: the pinned "Family" spaces and
 * the other groups, how many of each Home shows, and when a quiet settled
 * group is worth offering to archive.
 */
import { hasHouseholdHome } from '@waves/core';

import { filterGroups, sortGroups, type GroupsEntry } from '@/lib/groupsList';

export interface SectionEntry extends GroupsEntry {
  readonly type?: string | null;
  readonly ledger_mode?: string | null;
}

/** Family (couple, home, pooled) and the rest, each newest activity first; `query` filters by name. */
export function splitFamily<T extends SectionEntry>(
  entries: readonly T[],
  query = '',
): { family: T[]; groups: T[] } {
  const sorted = sortGroups(filterGroups(entries, 'all', query), 'recent');
  return {
    family: sorted.filter((entry) => hasHouseholdHome(entry)),
    groups: sorted.filter((entry) => !hasHouseholdHome(entry)),
  };
}

/** Home shows every family space, then recent groups: at least `minGroups`, filling up to `limit` rows. */
export function homeGroupRows<T>(
  family: readonly T[],
  groups: readonly T[],
  limit = 5,
  minGroups = 3,
): { family: T[]; groups: T[]; more: boolean } {
  const room = Math.max(minGroups, limit - family.length);
  return {
    family: [...family],
    groups: groups.slice(0, room),
    more: groups.length > room,
  };
}

export const ARCHIVE_QUIET_DAYS = 60;

/** The first settled, non-family group with no activity for 60 days that the person has not kept. */
export function archiveSuggestion<T extends SectionEntry>(
  entries: readonly T[],
  nowMs: number,
  kept: ReadonlySet<string>,
): T | null {
  const cutoff = nowMs - ARCHIVE_QUIET_DAYS * 86_400_000;
  return (
    entries.find(
      (entry) =>
        !hasHouseholdHome(entry) &&
        entry.balance === 0n &&
        !entry.needsAction &&
        entry.lastActive > 0 &&
        entry.lastActive <= cutoff &&
        !kept.has(entry.id),
    ) ?? null
  );
}
