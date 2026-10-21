/**
 * How many groups a Free account may start.
 *
 * ADR-011 keeps the ledger free: being in a group, adding to it, settling it
 * and exporting it never cost anything, at any count. What a Free account is
 * held to is *starting* groups — ten of them. Joining somebody else's group is
 * not limited, and neither is anything inside a group.
 *
 * Three rules decide what counts, and the database applies the same three
 * (`waves_created_group_count`), so the number a screen shows and the number
 * the server refuses on are one number:
 *
 *   - groups this person created, not groups they are in;
 *   - deleted groups do not count, archived ones do — archiving is a view, not a
 *     way to make room, or the ceiling would be a formality;
 *   - a pair (a group with exactly two live members — the one-to-one ledger the
 *     People tab draws as a person) does not count. Nothing on the server marks
 *     a pair; it is recognised by its live membership, here as there.
 *
 * The ceiling itself is enforced in SQL (`waves_assert_group_cap`, called by
 * `waves_create_group` and a trigger on `groups`). This file is what the
 * clients use to stop before the form rather than after the refusal, and to
 * recognise the refusal when a queued create meets it anyway.
 */

import { isPaidTier, type PlanTier } from './plans';

/** Groups a Free account may create. Pro has no ceiling. */
export const FREE_GROUP_LIMIT = 10;

/** The `CODE:` the database raises when the ceiling is hit. */
export const FREE_GROUP_LIMIT_CODE = 'FREE_GROUP_LIMIT';

/** Groups this tier may create; infinite for a paid tier. */
export function groupCreateLimit(tier: PlanTier): number {
  return isPaidTier(tier) ? Number.POSITIVE_INFINITY : FREE_GROUP_LIMIT;
}

export interface GroupCapInput {
  readonly tier: PlanTier;
  /** Groups this person created that count (see `countsTowardGroupCap`). */
  readonly createdCount: number;
}

export interface GroupCapGate {
  readonly limit: number;
  readonly created: number;
  /** Creates left before the ceiling; infinite on a paid tier. */
  readonly remaining: number;
  readonly atLimit: boolean;
  readonly canCreate: boolean;
}

/** Whether one more group may be started, and how many are left. */
export function groupCapGate(input: GroupCapInput): GroupCapGate {
  const limit = groupCreateLimit(input.tier);
  const created = Math.max(
    0,
    Math.floor(Number.isFinite(input.createdCount) ? input.createdCount : 0),
  );
  const remaining = Number.isFinite(limit)
    ? Math.max(0, limit - created)
    : Number.POSITIVE_INFINITY;
  const atLimit = created >= limit;
  return { limit, created, remaining, atLimit, canCreate: !atLimit };
}

export interface GroupCapRow {
  /** Who started it; absent on a row that exists only in the local queue. */
  readonly created_by?: string | null;
  readonly deleted_at?: string | null;
  /** True while the row exists only in the local queue — which only ever holds the viewer's own creates. */
  readonly pending?: boolean;
}

/**
 * Whether one group counts toward the viewer's ceiling: theirs, not deleted,
 * and not a pair. `liveMemberCount` is members who have not left, ghosts
 * included — two of them is the one-to-one ledger.
 */
export function countsTowardGroupCap(
  group: GroupCapRow,
  viewerId: string | null,
  liveMemberCount: number,
): boolean {
  if (group.deleted_at) return false;
  const mine =
    typeof group.created_by === 'string' && group.created_by !== ''
      ? viewerId !== null && group.created_by === viewerId
      : group.pending === true;
  if (!mine) return false;
  return liveMemberCount !== 2;
}

/**
 * Recognise the database's refusal wherever it surfaces — a thrown
 * PostgrestError, an `Error` wrapping its message, a rejected queue outcome.
 */
export function isFreeGroupLimitError(caught: unknown): boolean {
  if (typeof caught === 'string') return caught.includes(FREE_GROUP_LIMIT_CODE);
  if (typeof caught !== 'object' || caught === null) return false;
  const parts = caught as { code?: unknown; message?: unknown };
  const haystack = `${typeof parts.code === 'string' ? parts.code : ''} ${
    typeof parts.message === 'string' ? parts.message : ''
  }`;
  return haystack.includes(FREE_GROUP_LIMIT_CODE);
}
