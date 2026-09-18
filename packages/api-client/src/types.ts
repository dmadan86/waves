/**
 * The rows web-lite reads, and nothing more.
 *
 * These are deliberately not the app's types. The app reads a full mirror; a
 * guest on a link reads one group and needs a fraction of it, and asking for
 * columns nobody renders is asking RLS to prove more than it has to.
 */

import type { CategoryMeta, ExpenseLocation, SplitParams } from '@waves/core';
import type { GroupType } from './rows';

export type MemberId = string;

export interface Group {
  id: string;
  name: string | null;
  cover_emoji: string | null;
  default_currency: string;
  simplify_debts: boolean;
  /**
   * What kind of group this is — read, not decoration: it decides which of the
   * trip screens a group leads to. Optional because the guest link's own read
   * predates it and has no use for it.
   */
  type?: GroupType;
}

export interface Member {
  id: MemberId;
  group_id: string;
  profile_id: string | null;
  ghost_name: string | null;
  left_at: string | null;
  /** 'admin' can resolve disputes and manage the group; absent on the leaner reads. */
  role?: 'admin' | 'member';
  profile: { display_name: string | null } | null;
}

export interface ExpenseVersion {
  id: string;
  version_no: number;
  description: string;
  category: string | null;
  /**
   * The custom tag's snapshot (A42), when the category is a user tag rather
   * than a built-in.
   *
   * It travels on the version because a tag is only itself while its snapshot
   * is present: without this, spending folds every custom tag into the
   * built-in "Other", which is what the browser did until it started drawing
   * the charts and the gap became visible.
   */
  category_meta?: CategoryMeta | null;
  expense_date: string;
  currency: string;
  /** Minor units as a decimal string — the wire never carries a JS number for money. */
  amount: string;
  split_type: string;
  split_params: SplitParams;
  /** Where the spend happened (A43): a {lat, lng, name} snapshot, or null. */
  location?: ExpenseLocation | null;
  /** The kept bill (E2), when one was kept. Resolve it with `receipt`. */
  receipt_id?: string | null;
  /**
   * A view-only link to the author's OWN cloud copy of the bill (E3). Not ours
   * and not signed by us — it is shown as a link out, never loaded as an image.
   */
  receipt_share_url?: string | null;
  payers: { member_id: MemberId; amount: string }[];
  shares: { member_id: MemberId; amount: string }[];
}

export interface Expense {
  id: string;
  group_id: string;
  deleted_at: string | null;
  created_at: string;
  currentVersion: ExpenseVersion | null;
}

export interface Settlement {
  id: string;
  group_id: string;
  from_member_id: MemberId;
  to_member_id: MemberId;
  currency: string;
  amount: string;
  status: string;
  initiated_at: string;
  confirmed_at: string | null;
  allocations?: { expense_id: string; amount: string }[];
}

/** What a link shows before anybody has committed to joining. */
export interface InvitePreview {
  group: {
    id: string;
    name: string | null;
    cover_emoji: string | null;
    default_currency: string;
  } | null;
  memberCount: number;
  /** Ghost members on the group whose place the arrival can take (ADR-006). */
  claimable: { memberId: string; name: string | null }[];
}

/**
 * What came back from joining.
 *
 * Two shapes, because claiming somebody's place is now a request rather than a
 * join (ADR-006): an admin of the group decides, and until they do the arrival
 * is not a member and there is no `memberId` to give them.
 */
export interface AcceptedInvite {
  group: { id: string; name: string | null };
  memberId?: MemberId;
  claimed?: boolean;
  /** Waiting on an admin. `memberId` is absent. */
  pending?: boolean;
  claimId?: string;
  /** They had already asked; this is the same request, not a second one. */
  alreadyPending?: boolean;
}

/** The name web-lite shows for somebody. */
export function nameOf(member: Member): string {
  return member.profile?.display_name ?? member.ghost_name ?? 'Someone';
}
