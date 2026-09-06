/**
 * When the balance cross-check (ADR-004) is allowed to have an opinion.
 *
 * The client recomputes every balance from the append-only ledger; the server
 * keeps its own `group_balances` projection. They must agree, and a CI
 * invariant holds the server's copy to the same truth query. So a disagreement
 * seen on a phone is nearly always a question of *timing* rather than of
 * arithmetic: the local ledger changes the instant a mutation reaches disk,
 * while the server's copy is a network read taken at whatever moment the query
 * last ran.
 *
 * Comparing across that gap is what produced a red "balances need a refresh"
 * card in front of people whose books were, in fact, exactly right. This is the
 * predicate that decides whether the two sides are describing the same moment.
 * It is deliberately conservative: every uncertain case is "not comparable",
 * because a missed cross-check costs us a report we can chase from the server,
 * and a false one costs somebody their confidence in their own money.
 */
export interface CrossCheckTiming {
  /** Anything of this group's still sitting in the mutation queue. Counted from
   *  the queue itself: a queued settlement moves a balance exactly as an
   *  expense does, and carries no `pending` flag on any expense row. */
  queuedHere: boolean;
  /** True while a sync is in flight — the server is mid-answer. */
  syncing: boolean;
  /** True while the balances query itself is in flight. */
  fetching: boolean;
  /** `dataUpdatedAt` of the balances query; 0 when nothing has arrived. */
  fetchedAt: number;
  /** When the last successful sync completed, in ms. 0 when never. */
  syncedAt: number;
}

export function isCrossCheckComparable(timing: CrossCheckTiming): boolean {
  if (timing.queuedHere || timing.syncing || timing.fetching) return false;
  // No server snapshot to compare against.
  if (timing.fetchedAt <= 0) return false;
  // A snapshot older than the last sync describes a moment before the writes
  // that sync carried — the exact shape of the false alarm.
  return timing.fetchedAt >= timing.syncedAt;
}
