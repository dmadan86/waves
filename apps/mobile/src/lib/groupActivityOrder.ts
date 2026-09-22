/**
 * Which groups get the dashboard's limited slots: the ones being used.
 *
 * The preview shows fifteen groups and a person can be in far more. Until now
 * the fifteen were whichever came back first, which is `created_at` — the day
 * you were *added* to a group, not the day anything happened in it. So a trip
 * that ended in March could hold a slot for a year while the flat you settle up
 * in every week fell off the bottom, and pinning was the only cure.
 *
 * Recency fixes that without hiding anything, which matters: a settled group is
 * not a finished one. You go back to it to add the next expense, and a list that
 * drops a group the moment you square up would make the group you use most
 * disappear and reappear. Ordering by activity lets a dormant group sink on its
 * own, because nothing is happening in it — and brings it straight back the
 * moment somebody spends.
 *
 * "Activity" is when the ledger last changed: an expense entered, a settlement
 * raised or confirmed. Not the expense *date* — a receipt from last week typed
 * in this morning is this morning's activity, and sorting it under last week
 * would bury the group you are standing in. A group with no ledger at all falls
 * back to its own creation, so one made a minute ago is at the top where it
 * belongs rather than the bottom where an empty ledger would put it.
 *
 * Note the dashboard and the All-groups screen now answer different questions on
 * purpose: this one is "what am I using", which is what a fifteen-row preview is
 * for, and that one is "where does my money stand", which is what a full list
 * sorted by balance is for. Pinning still sits in front of both (`orderByPin`).
 */

/**
 * Milliseconds for an ISO timestamp, or 0 when there is not one.
 *
 * Parsed rather than compared as text: these strings come from Postgres, the
 * queue and the device, and two of those can disagree about whether an offset
 * is written `Z` or `+00:00` — which sorts wrong lexicographically while being
 * the same instant. Anything unparseable is treated as "no activity" rather
 * than as `NaN`, which would make the comparator incoherent and the order
 * arbitrary.
 */
export function activityTime(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Most recently active first.
 *
 * Decorated before sorting so `activityOf` is asked once per item rather than
 * once per comparison, and so the sort itself only ever compares numbers.
 * Ties keep the order they arrived in — `Array.prototype.sort` has been
 * stable since ES2019 — which is what stops two groups that were touched in
 * the same millisecond, or two that have never been touched at all, from
 * swapping places on every render.
 */
export function orderByActivity<T>(items: readonly T[], activityOf: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, at: activityOf(item) }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : b.at - a.at))
    .map((entry) => entry.item);
}
