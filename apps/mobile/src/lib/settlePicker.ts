/**
 * The settle-up picker's own filter, chips and sort: what survives a search,
 * a chip and a sort choice, as plain functions a test can call directly.
 *
 * Pulled out from the sheet itself so the matching is a plain function a test
 * can call directly, the same shape `matchesAssignGroupQuery` already is for
 * the capture-assign picker — reused here rather than copied, since "does
 * this query match this group's name" is exactly the same question in both.
 */

import { GroupType } from '../data/types';
import { matchesAssignGroupQuery } from './captureAssign';

/** Any row carrying a name to search by — a `SettleCandidate`, in practice,
 *  kept generic here so this file has no reason to import the component. */
export interface SettleSearchable {
  title: string;
}

/** The candidates a query leaves standing, in their given order. An empty (or
 *  all-whitespace) query matches everything. */
export function filterSettleCandidates<T extends SettleSearchable>(
  candidates: readonly T[],
  query: string,
): T[] {
  return candidates.filter((candidate) => matchesAssignGroupQuery(candidate.title, query));
}

export type SettleChip = 'all' | 'yours' | 'trips' | 'family' | 'friends';
export const SETTLE_CHIPS: readonly SettleChip[] = ['all', 'yours', 'trips', 'family', 'friends'];

export type SettleSort = 'balance' | 'recent' | 'name';
export const SETTLE_SORTS: readonly SettleSort[] = ['balance', 'recent', 'name'];

/** What the chips and sort need from a candidate. */
export interface SettleFilterable extends SettleSearchable {
  type: GroupType;
  balance: bigint;
  /** Latest ledger activity in ms; 0 when unknown. */
  lastActivityAt: number;
  /** True when the signed-in person is an admin of the group. */
  isAdmin: boolean;
}

/** Which group types a type chip stands for. Family is home and couple. */
export function chipGroupTypes(chip: SettleChip): readonly GroupType[] | null {
  switch (chip) {
    case 'trips':
      return [GroupType.Trip];
    case 'family':
      return [GroupType.Home, GroupType.Couple];
    case 'friends':
      return [GroupType.Friends];
    default:
      return null;
  }
}

/** Does this candidate belong under the chip? "Your groups" is the groups you
 *  administer — groups carry no creator column, so admin is the nearest rule. */
export function matchesSettleChip(candidate: SettleFilterable, chip: SettleChip): boolean {
  if (chip === 'all') return true;
  if (chip === 'yours') return candidate.isAdmin;
  return chipGroupTypes(chip)?.includes(candidate.type) ?? true;
}

const absBig = (n: bigint): bigint => (n < 0n ? -n : n);

/** A new array in the chosen order; ties keep their given order. */
export function sortSettleCandidates<T extends SettleFilterable>(
  candidates: readonly T[],
  sort: SettleSort,
  locale?: string,
): T[] {
  const copy = [...candidates];
  if (sort === 'name') return copy.sort((a, b) => a.title.localeCompare(b.title, locale));
  if (sort === 'recent') return copy.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return copy.sort((a, b) => {
    const x = absBig(a.balance);
    const y = absBig(b.balance);
    return x === y ? 0 : y > x ? 1 : -1;
  });
}

/** Search, then chip, then sort. */
export function arrangeSettleCandidates<T extends SettleFilterable>(
  candidates: readonly T[],
  options: { query: string; chip: SettleChip; sort: SettleSort; locale?: string },
): T[] {
  const matched = filterSettleCandidates(candidates, options.query).filter((c) =>
    matchesSettleChip(c, options.chip),
  );
  return sortSettleCandidates(matched, options.sort, options.locale);
}
