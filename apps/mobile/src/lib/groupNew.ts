/**
 * Which expenses in a group are news to the reader: added or edited by somebody
 * else after the reader last opened the group. The unread dot says "something
 * happened in here"; this is the rest of the sentence, so the group screen can
 * point at the rows that did it.
 *
 * Read from the group's `activity_log`: an `added` row on an expense is a
 * creation, an `edited` (or `restored`) row an edit, and `actor_member_id` is
 * who did it. The reader's own rows never count — the same rule as the dot —
 * and an unknown last look (`null` / `undefined`) marks nothing, for the same
 * reason the dot stays dark then: a screen that lit every row on a first run
 * would be worse than none.
 *
 * Pure: the screen passes the log, a "that is me" test and the previous look.
 */

export type NewKind = 'new' | 'edited';

/** What somebody else did to one expense since the reader last looked. */
export interface NewMark {
  kind: NewKind;
  /** The member who added it, or made the latest edit; null for a system row. */
  byMemberId: string | null;
  /** ms of that row. */
  at: number;
}

/** The slice of an activity row this rule reads. */
export interface NewLogRow {
  verb: string;
  object_type: string;
  object_id: string | null;
  actor_member_id: string | null;
  created_at: string;
}

/**
 * Expense id → what changed about it since `seenAt`. An expense someone else
 * added after `seenAt` is `new` however often it was edited since; one only
 * edited is `edited`, by the latest editor. A row at exactly `seenAt` was seen.
 */
export function newMarksSince(
  rows: readonly NewLogRow[],
  isMine: (memberId: string) => boolean,
  seenAt: number | null | undefined,
): Map<string, NewMark> {
  const out = new Map<string, NewMark>();
  if (seenAt === null || seenAt === undefined) return out;
  for (const row of rows) {
    if (row.object_type !== 'expense' || !row.object_id) continue;
    const kind: NewKind | null =
      row.verb === 'added'
        ? 'new'
        : row.verb === 'edited' || row.verb === 'restored'
          ? 'edited'
          : null;
    if (!kind) continue;
    if (row.actor_member_id && isMine(row.actor_member_id)) continue;
    const at = Date.parse(String(row.created_at));
    if (!(at > seenAt)) continue;
    const prev = out.get(row.object_id);
    if (prev?.kind === 'new' && kind === 'edited') continue;
    if (prev && prev.kind === kind && prev.at >= at) continue;
    out.set(row.object_id, { kind, byMemberId: row.actor_member_id, at });
  }
  return out;
}
