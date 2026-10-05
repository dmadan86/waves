/**
 * Whether a group that is not in the local mirror yet might still be on its way.
 *
 * The mirror is filled by the sync pull, and `hydrated` only says the *disk* has
 * been read. Two moments leave a perfectly real group missing from it: right
 * after accepting an invite (the server has the membership, this phone has not
 * pulled it), and a brand-new session's first sync (a guest who has just been
 * created starts with an empty mirror). A screen that judged "not found" in
 * either gap told somebody who had joined a second ago that the group did not
 * exist.
 *
 * Both are bounded. The first sync settles into success or a status that says
 * the network cannot answer, and an expected group is only waited for within a
 * window, after which the honest answer is "not found".
 */

/** How long a just-joined group is waited for before the screen gives up. */
export const ARRIVAL_WINDOW_MS = 10_000;

const expected = new Map<string, number>();

/** Called by the join flow: this group is a membership the mirror has yet to see. */
export function expectGroup(groupId: string, now: number = Date.now()): void {
  expected.set(groupId, now);
}

/** Stop waiting for `groupId` (it arrived, or the wait is over). */
export function forgetExpectedGroup(groupId: string): void {
  expected.delete(groupId);
}

/** Milliseconds left in the wait for `groupId`; 0 when nothing is expected. */
export function expectedGroupRemaining(groupId: string, now: number = Date.now()): number {
  const since = expected.get(groupId);
  if (since === undefined) return 0;
  const left = since + ARRIVAL_WINDOW_MS - now;
  if (left <= 0) {
    expected.delete(groupId);
    return 0;
  }
  return left;
}

export interface ArrivalInput {
  /** The group is already in the mirror. */
  found: boolean;
  hydrated: boolean;
  /** This session's first sync has succeeded. */
  hasSynced: boolean;
  /** The engine's status. */
  status: string;
  /** The join flow expects this group and its window is still open. */
  expecting: boolean;
}

/** True while "not found" would be premature, so the screen should keep loading. */
export function groupMayStillArrive(input: ArrivalInput): boolean {
  if (input.found) return false;
  if (input.expecting) return true;
  // The same bound the dashboard and the restore prompt use for "no first sync
  // yet": it ends in a success, or in a status that says the network cannot answer.
  return (
    input.hydrated && !input.hasSynced && (input.status === 'idle' || input.status === 'syncing')
  );
}
