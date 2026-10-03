/**
 * The settle-up picker's own filter: past a handful of groups a flat scan is
 * slower than typing a few letters, so a search field earns its place and
 * this decides what survives it.
 *
 * Pulled out from the sheet itself so the matching is a plain function a test
 * can call directly, the same shape `matchesAssignGroupQuery` already is for
 * the capture-assign picker — reused here rather than copied, since "does
 * this query match this group's name" is exactly the same question in both.
 */

import { matchesAssignGroupQuery } from './captureAssign';

/** Past this many candidates the picker grows a search field; a shorter list
 *  is faster to eyeball than to type through. */
export const SETTLE_SEARCH_THRESHOLD = 8;

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
