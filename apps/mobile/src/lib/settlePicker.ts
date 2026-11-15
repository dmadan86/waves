/**
 * The settle-up picker's own filter: what survives a search, as a plain
 * function a test can call directly.
 *
 * Pulled out from the component so the matching is a plain function a test
 * can call directly, the same shape `matchesAssignGroupQuery` already is for
 * the capture-assign picker — reused here rather than copied, since "does
 * this query match this group's name" is exactly the same question in both.
 */

import { matchesAssignGroupQuery } from './captureAssign';

export type SettleFilter = 'all' | 'owed' | 'owe';

/** Keep candidates by balance sign, preserving their order. */
export function filterSettleByBalance<T extends { balance: bigint }>(
  candidates: readonly T[],
  filter: SettleFilter,
): T[] {
  return candidates.filter(
    (candidate) =>
      filter === 'all' || (filter === 'owed' ? candidate.balance > 0n : candidate.balance < 0n),
  );
}

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
