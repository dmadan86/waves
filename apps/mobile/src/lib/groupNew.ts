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
  // The reader's own latest write on a bill: an edit by somebody else before it
  // is no longer the news (both phones then agree who edited last).
  const mineAt = new Map<string, number>();
  for (const row of rows) {
    if (row.object_type !== 'expense' || !row.object_id || !row.actor_member_id) continue;
    if (!isMine(row.actor_member_id)) continue;
    if (row.verb !== 'added' && row.verb !== 'edited' && row.verb !== 'restored') continue;
    mineAt.set(
      row.object_id,
      Math.max(mineAt.get(row.object_id) ?? 0, Date.parse(String(row.created_at))),
    );
  }
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
    if (kind === 'edited' && at <= (mineAt.get(row.object_id) ?? 0)) continue;
    const prev = out.get(row.object_id);
    if (prev?.kind === 'new' && kind === 'edited') continue;
    if (prev && prev.kind === kind && prev.at >= at) continue;
    out.set(row.object_id, { kind, byMemberId: row.actor_member_id, at });
  }
  return out;
}

/** The slice of an activity row {@link replacedEditNotice} reads. */
export interface ReplacedLogRow extends NewLogRow {
  payload?: Record<string, unknown> | null;
}

/**
 * Two phones edited the same bill offline: the later one wins and the earlier
 * one stays in the history (ADR-005), logged as a `superseded` row naming whose
 * edit it replaced. The person who lost has to be told — otherwise their change
 * just vanishes. Returns who replaced it, or null when the reader's edit stands.
 */
export function replacedEditNotice(
  rows: readonly ReplacedLogRow[],
  expenseId: string,
  isMine: (memberId: string) => boolean,
): { byMemberId: string | null } | null {
  let latest: ReplacedLogRow | null = null;
  for (const row of rows) {
    if (row.verb !== 'superseded' || row.object_id !== expenseId) continue;
    const loser = row.payload?.supersededAuthorMemberId;
    if (typeof loser !== 'string' || !isMine(loser)) continue;
    if (row.actor_member_id && isMine(row.actor_member_id)) continue; // my own other phone
    if (!latest || Date.parse(row.created_at) > Date.parse(latest.created_at)) latest = row;
  }
  return latest ? { byMemberId: latest.actor_member_id } : null;
}
