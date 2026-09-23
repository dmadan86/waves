/**
 * The recent-activity feed as a pure read over the mirror, so the screen hook
 * (`useRecentActivity`) and the watch relay share one definition — and the
 * relay can ask for only the newest few rows, on demand, instead of holding the
 * whole joined feed in memory on every sync.
 */

import {
  byNewest,
  rowsFor,
  SyncTable,
  type MemberId,
  type MirrorExpense,
  type MirrorState,
} from '@waves/core';

import { myStake } from './activity';
import { isViewer } from './types';
import type { ActivityActor, ActivityGroup, ActivityRow, ExpenseVersionRow } from './types';

export type RecentActivityRow = ActivityRow & {
  group: ActivityGroup | null;
  /**
   * What this event did to the reader's own balance, when that is knowable: an
   * expense event carries the reader's stake in that bill (positive: they lent,
   * negative: they borrowed) — the same figure the group ledger's expense rows
   * show, so a coloured amount means one thing across the app.
   *
   * Null when the event is not an expense, when the reader is on neither side
   * of the bill, or when no profile id was given. The row then falls back to
   * the payload's neutral total, which belongs to nobody in particular.
   */
  stake: { amount: bigint; currency: string } | null;
};

/**
 * The recent-activity feed, entirely from the mirror — offline-first (ADR-005).
 *
 * `activity_log` is already pulled into the mirror per group, so the global feed
 * is a read over what is on the phone rather than a network call: it shows the
 * moment the app opens, works with no connection, and never empties because a
 * request failed. The rows are stored raw (no embeds), so the group and the
 * actor are joined back on from the mirrored `groups` and `group_members` — a
 * member row carries its own `profile.display_name`, so a name needs no fetch.
 *
 * Newest-first across every group the phone knows about; the screen paginates
 * this local list rather than asking the server for the next page. `limit`
 * keeps only the newest that many, and joins only those.
 */
export function recentActivity(
  mirror: MirrorState,
  myProfileId: string | null = null,
  limit?: number,
): RecentActivityRow[] {
  const groups = new Map<string, ActivityGroup>();
  // Groups the mirror still holds only to carry their tombstone. Their rows
  // stay in `activity_log` — a delete is a tombstone, not an erasure (ADR-004)
  // — so without this the feed goes on listing what happened in a group that
  // is gone, each row linking to the "Group not found" screen.
  const deleted = new Set<string>();
  for (const row of rowsFor(mirror, SyncTable.Groups)) {
    const g = row as unknown as {
      id: string;
      name: string | null;
      cover_emoji: string | null;
      archived_at: string | null;
      deleted_at: string | null;
    };
    if (g.deleted_at) {
      deleted.add(g.id);
      continue;
    }
    groups.set(g.id, {
      id: g.id,
      name: g.name,
      cover_emoji: g.cover_emoji,
      archived_at: g.archived_at ?? null,
    });
  }

  const actors = new Map<string, ActivityActor>();
  for (const row of rowsFor(mirror, SyncTable.GroupMembers)) {
    const m = row as unknown as {
      id: string;
      profile_id: string | null;
      ghost_name: string | null;
      profile?: { display_name: string | null } | null;
    };
    actors.set(m.id, {
      id: m.id,
      profile_id: m.profile_id,
      ghost_name: m.ghost_name,
      profile: m.profile ? { display_name: m.profile.display_name } : null,
    });
  }

  // The reader's own member id in each group, so an expense event can be told
  // apart into "you lent" and "you borrowed". The same person holds a
  // different member id in every group, hence a map rather than one id.
  const myMemberByGroup = new Map<string, MemberId>();
  if (myProfileId) {
    for (const row of rowsFor(mirror, SyncTable.GroupMembers)) {
      const m = row as unknown as {
        id: MemberId;
        group_id: string;
        profile_id: string | null;
        left_at: string | null;
      };
      if (isViewer(m, myProfileId) && !m.left_at) myMemberByGroup.set(m.group_id, m.id);
    }
  }

  // Every expense the phone holds, by id — an activity row names its object,
  // so the stake is a map lookup rather than a scan per row.
  const expenseById = new Map<string, MirrorExpense>();
  if (myProfileId) {
    for (const row of rowsFor(mirror, SyncTable.Expenses) as MirrorExpense[]) {
      expenseById.set(row.id, row);
    }
  }

  // Sorted before it is joined: the order depends only on `created_at`, which
  // the join does not touch, so the result is the same — and a caller that
  // wants only the newest few (the watch) joins only those.
  const sorted = (rowsFor(mirror, SyncTable.ActivityLog) as unknown as ActivityRow[])
    // A row whose group the mirror has never seen is kept, with a null group —
    // that is the existing "newer build, unknown group" fallback and it reads
    // as a plain line. A row whose group the mirror knows to be deleted is
    // dropped, because there we know the destination is gone.
    .filter((row) => !deleted.has(row.group_id))
    .sort(byNewest((row) => String(row.created_at)));
  return (limit === undefined ? sorted : sorted.slice(0, limit)).map((row) => ({
    ...row,
    group: groups.get(row.group_id) ?? null,
    actor: row.actor_member_id ? (actors.get(row.actor_member_id) ?? null) : null,
    stake: stakeFor(row, expenseById, myMemberByGroup),
  }));
}

/**
 * The reader's stake in the expense an activity row is about, or null when the
 * row is not about an expense they are on. A settled/confirmed row is left
 * null on purpose: a settlement moves money one way and the balance the other,
 * so colouring it by either sign misreads the other — it keeps the neutral
 * total.
 */
function stakeFor(
  row: ActivityRow,
  expenseById: ReadonlyMap<string, MirrorExpense>,
  myMemberByGroup: ReadonlyMap<string, MemberId>,
): { amount: bigint; currency: string } | null {
  if (row.object_type !== 'expense' || !row.object_id) return null;
  const version = expenseById.get(row.object_id)?.currentVersion;
  if (!version) return null;
  const stake = myStake(
    version as unknown as ExpenseVersionRow,
    myMemberByGroup.get(row.group_id) ?? null,
  );
  // A square stake (paid exactly what you owed) has no direction to colour, so
  // it reads as the neutral total rather than a grey zero.
  if (stake === null || stake === 0n) return null;
  return { amount: stake, currency: version.currency };
}
