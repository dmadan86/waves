/**
 * The fuller rows the web dashboard reads.
 *
 * The guest link view (`types.ts`) asks for one group and a fraction of its
 * columns. The signed-in web client is the whole app in a browser: it lists
 * every group, totals balances across them, and shows a cross-group activity
 * feed. These row shapes mirror the mobile app's (`apps/mobile/src/data/types`)
 * so the two clients read the same columns and cannot disagree about a name or
 * a number.
 */

import type { NotificationPrefs, RailId } from '@waves/core';

export enum GroupType {
  Trip = 'trip',
  Home = 'home',
  Couple = 'couple',
  Event = 'event',
  /** Added with the Friends tab (#347); the database enum has carried it since. */
  Friends = 'friends',
  Other = 'other',
}

export interface GroupRow {
  id: string;
  name: string | null;
  type: GroupType;
  country_code: string | null;
  default_currency: string;
  simplify_debts: boolean;
  cover_emoji: string | null;
  photo_path: string | null;
  start_date: string | null;
  end_date: string | null;
  /** The trip is on ITS day, not the reader's — the planner compares dates in this zone. */
  time_zone: string;
  /**
   * The trip's overall cap, in minor units. Null is unset, which is not the
   * same as a cap of zero and must not draw a bar.
   */
  budget_minor: string | null;
  budget_currency: string | null;
  archived_at: string | null;
  created_at: string;
  /**
   * The row's revision. A trigger bumps it on every write to the group, which
   * makes it the thing a form can hold on to and hand back — see
   * `updateGroup`'s `ifUpdatedSeq`.
   */
  updated_seq: number;
}

export interface MemberRow {
  id: string;
  group_id: string;
  profile_id: string | null;
  ghost_name: string | null;
  role?: 'admin' | 'member';
  /** The UPI-shaped fields. Superseded by the rail pair; still read as a fallback. */
  vpa?: string | null;
  /** Which rail this person is paid on here — a `RailId` from `@waves/core`. */
  payment_rail?: string | null;
  payment_handle?: string | null;
  left_at: string | null;
  profile?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    default_vpa?: string | null;
    payment_rail?: string | null;
    payment_handle?: string | null;
  } | null;
}

export interface BalanceRow {
  group_id: string;
  member_id: string;
  currency: string;
  /** Positive: this member is owed. Negative: they owe. Minor units, decimal string. */
  balance: string;
}

export interface ActivityActor {
  id: string;
  profile_id: string | null;
  ghost_name: string | null;
  profile: { display_name: string | null } | null;
}

export interface ActivityGroup {
  id: string;
  name: string | null;
  cover_emoji: string | null;
}

export interface ActivityRow {
  id: string;
  group_id: string;
  actor_member_id: string | null;
  actor?: ActivityActor | null;
  verb: string;
  object_type: string;
  object_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  /** Present only on the cross-group feed. */
  group?: ActivityGroup | null;
}

export enum DisputeStatus {
  Open = 'open',
  Resolved = 'resolved',
  Withdrawn = 'withdrawn',
  Rejected = 'rejected',
}

/**
 * Somebody saying an expense is wrong. Never moves a balance on its own — a
 * share you could remove unilaterally would be a debt you could delete
 * (ADR-004). The table is read-only to clients; every write goes through an RPC.
 */
export interface DisputeRow {
  id: string;
  expense_id: string;
  member_id: string;
  reason: string | null;
  status: DisputeStatus;
  resolved_by_member_id: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** A row in an expense's edit history (ADR-004 keeps every version). */
export interface ExpenseVersionSummary {
  id: string;
  version_no: number;
  description: string;
  amount: string;
  currency: string;
  created_at: string;
  author_member_id: string | null;
  split_type: string;
  category: string | null;
  /** The custom-tag snapshot (A42), which carries the tag's own label. */
  category_meta: { label?: string } | null;
  expense_date: string;
  location: { lat: number; lng: number; name?: string | null } | null;
  /** Who put money in, and how much each of them put in. */
  payers: { member_id: string; amount: string }[];
  /** Who is splitting it. */
  shares: { member_id: string; amount: string }[];
}

/**
 * One line of the image audit (A46): who added or removed a receipt or an
 * attachment, and when.
 *
 * The kept bill has no row of its own to soft-delete, so this table is where
 * "somebody replaced the receipt" is recorded at all. A `parties` line only
 * reaches a party to the bill — the RLS policy is `is_group_member AND
 * (visibility = 'group' OR waves_is_expense_party(...))`, so a row that comes
 * back is a row this reader is allowed to see.
 */
export interface ExpenseImageEvent {
  id: string;
  expense_id: string;
  actor_member_id: string | null;
  kind: 'receipt' | 'attachment';
  action: 'added' | 'removed';
  visibility: 'group' | 'parties';
  created_at: string | null;
}

/**
 * A kept bill (E2). One per expense at most, group-readable: the receipt for a
 * bill everybody is paying a share of is not a private document.
 *
 * `storage_path` is a key inside a private bucket and is never a URL — see
 * `imageUrl`, which resolves it to a short-lived signed one.
 */
export interface Receipt {
  id: string;
  group_id: string;
  storage_path: string | null;
  created_at: string | null;
}

/**
 * An image attached to an expense after the fact (A44/A46).
 *
 * `visibility` is the whole point of the row: `group` behaves like the receipt
 * above, `parties` is visible only to the people on the bill. The RLS policy
 * enforces both, so a read that returns the row is a read that was allowed —
 * this client does no gating of its own.
 */
export interface ExpenseAttachment {
  id: string;
  expense_id: string;
  group_id: string;
  uploader_member_id: string;
  storage_path: string;
  visibility: 'group' | 'parties';
  created_at: string | null;
}

/**
 * One comment on an expense (A46).
 *
 * `author_member_id` is a group member, not a profile — a comment outlives the
 * person leaving the group, and the ledger names members everywhere else too.
 * It is nullable because the server stamps it from the caller's membership and
 * an import can leave it unset.
 *
 * Deleted comments are not returned: the read filters them out rather than
 * carrying tombstones a renderer would have to know to skip.
 */
export interface ExpenseComment {
  id: string;
  group_id: string;
  expense_id: string;
  author_member_id: string | null;
  /** Markdown, in the tiny subset @waves/core's sanitiser normalises to. */
  body: string;
  edited_at: string | null;
  flagged_at: string | null;
  flagged_by: string | null;
  created_at: string | null;
}

export enum SettlementMethod {
  Upi = 'upi',
  Cash = 'cash',
  Bank = 'bank',
  Other = 'other',
}

export enum SettlementStatus {
  Initiated = 'initiated',
  Confirmed = 'confirmed',
  AutoConfirmed = 'auto_confirmed',
  Disputed = 'disputed',
  Cancelled = 'cancelled',
}

/**
 * The coarse `method` enum the settlements table stores, derived from the finer
 * `RailId` the group actually settled on. A rail the enum has never heard of —
 * Pix, PayNow, Wise — records as `other` while the exact rail rides alongside
 * in its own column, so a new country is data, not a new enum value (see
 * `@waves/core`'s rails). Kept pure and exported so the mapping is tested once
 * and cannot drift between the phone and the browser.
 */
export function coarseMethod(rail: string): SettlementMethod {
  return (
    [
      SettlementMethod.Upi,
      SettlementMethod.Cash,
      SettlementMethod.Bank,
      SettlementMethod.Other,
    ] as const
  ).includes(rail as SettlementMethod)
    ? (rail as SettlementMethod)
    : SettlementMethod.Other;
}

export enum CaptureStatus {
  Open = 'open',
  Assigned = 'assigned',
}

/**
 * A captured expense with no group yet (TDR A34). Personal until assigned:
 * owned by one user, synced under that owner's own scope, carrying no members
 * and no split. Which rows are whose is decided by the owner-only `captures_own`
 * RLS policy, not by any filter here.
 */
export interface CaptureRow {
  id: string;
  owner_user_id: string;
  description: string;
  category: string | null;
  expense_date: string;
  currency: string;
  /** Minor units as a decimal string — BIGINT never fits a JS number. */
  amount: string;
  notes: string | null;
  photo_path: string | null;
  raw_text: string | null;
  parsed: Record<string, unknown> | null;
  status: CaptureStatus;
  assigned_expense_id: string | null;
  assigned_group_id: string | null;
  created_at: string;
}

/**
 * A line in the inbox — everything Waves has told this person, whether or not a
 * push ever reached the device (TDR §7.1 calls it the ledger of record). Which
 * rows are whose is decided by the `notifications_select_own` RLS policy, not
 * by any filter here.
 */
export interface NotificationRow {
  id: string;
  group_id: string | null;
  kind: string;
  title: string;
  body: string;
  deep_link: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

/** One row per person per currency, from the `waves_people_i_owe` RPC. */
export interface PersonBalanceRow {
  person_key: string;
  profile_id: string | null;
  member_id: string;
  display_name: string;
  avatar_url: string | null;
  is_ghost: boolean;
  currency: string;
  /** Positive: they owe you. Negative: you owe them. Minor units. */
  net: string;
  group_count: number;
  only_group_id: string | null;
}

/** Display name for a member, real or ghost — "You" when it is the reader. */
export function memberName(member: MemberRow, myProfileId?: string | null): string {
  if (member.profile_id && member.profile_id === myProfileId) return 'You';
  return member.profile?.display_name ?? member.ghost_name ?? 'Someone';
}

/** "Ravi", or "You" when it was the reader; "Someone" when the actor has left. */
export function actorName(
  actor: ActivityActor | null | undefined,
  myProfileId: string | null,
): string {
  if (!actor) return 'Someone';
  if (myProfileId && actor.profile_id === myProfileId) return 'You';
  return actor.profile?.display_name ?? actor.ghost_name ?? 'Someone';
}

/**
 * What to call a group that has no name: the people are the label.
 * "You, Priya and Ravi" beats "Untitled group" for the same reason a photo of
 * your friends beats a filename — you recognise it without reading it.
 */
export function groupLabel(
  group: Pick<GroupRow, 'name'> | null | undefined,
  members: readonly MemberRow[] = [],
  myProfileId?: string | null,
): string {
  const named = group?.name?.trim();
  if (named) return named;

  const others = members
    .filter((member) => !member.left_at)
    .filter((member) => !(member.profile_id && member.profile_id === myProfileId))
    .map((member) => memberName(member, myProfileId));

  if (others.length === 0) return 'New group';
  if (others.length === 1) return `You and ${others[0]}`;
  if (others.length === 2) return `You, ${others[0]} and ${others[1]}`;
  return `You, ${others[0]} and ${others.length - 1} others`;
}

/**
 * The signed-in person's own row, as the settings screens edit it.
 *
 * `notification_prefs` is JSON rather than columns because the set of things
 * worth being told about changes with the product, and a migration per switch
 * would be a migration per idea.
 */
export interface ProfileRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  /**
   * How this person is paid: a `RailId` from @waves/core, and a handle on it.
   * Narrower than the column, deliberately — the database accepts only the
   * rails the enum names, so a typo like `'bitcoin'` should fail here rather
   * than on the way to a constraint.
   */
  payment_rail: RailId | null;
  payment_handle: string | null;
  /** The UPI-shaped field this predates the rail pair; still read as a fallback. */
  default_vpa: string | null;
  /** ISO-3166 alpha-2 — seeds a new group's country and its currency. */
  country_code: string | null;
  default_currency: string;
  locale: string;
  notification_prefs?: NotificationPrefs | null;
}

/**
 * Re-exported so a caller holding a `ProfileRow` does not have to know that the
 * shape lives in `@waves/core`. One definition, three consumers — see the note
 * on the source for why it moved there.
 */
export { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@waves/core';

/**
 * One person's balance in one group — the un-collapsed version of what the
 * Friends list nets together, so tapping a name can say *where* the money is
 * rather than only how much.
 */
export interface PersonGroupBalanceRow {
  group_id: string;
  group_name: string | null;
  cover_emoji: string | null;
  currency: string;
  /** Positive: they owe you here. Negative: you owe them. Minor units. */
  net: string;
  is_ghost: boolean;
  display_name: string;
}

/** A file the server built for somebody to take their ledger away (ADR-012). */
export interface ExportResult {
  filename: string;
  contentType: string;
  content: string;
  /** 'base64' when `content` is binary (PDF); text formats omit it. */
  encoding?: 'utf8' | 'base64';
}

/**
 * One line of a trip's plan: something somebody intends to do, and what they
 * think it will cost.
 *
 * Not money. A plan item moves nobody's balance, never reaches the export, and
 * ticking it off is somebody saying they did the thing — not that they paid for
 * it. `planned_minor` sits beside what the ledger actually recorded; the two are
 * never added together and never converted into each other (ADR-003).
 */
export interface PlanItemRow {
  id: string;
  group_id: string;
  /** 'YYYY-MM-DD', in the trip's own timezone. */
  day: string;
  /** 'HH:MM:SS' or null for "sometime that day". */
  starts_at: string | null;
  title: string;
  note: string | null;
  category: string | null;
  /** Minor units as a decimal string, or null for "no idea yet". */
  planned_minor: string | null;
  currency: string;
  /** Non-null once somebody ticked it off. */
  done_at: string | null;
  /** The expense that turned out to be this, once somebody links them. */
  expense_id: string | null;
  position: number;
}

/**
 * One member's own ceiling for a trip.
 *
 * What comes back is already what the caller may see: the select policy is
 * `is_group_member AND (visibility = 'group' OR member_id = my member id)`, so
 * a private row belonging to somebody else never arrives. The client does no
 * filtering of its own, because a client that filtered would be trusted to.
 */
export interface MemberBudgetRow {
  id: string;
  group_id: string;
  member_id: string;
  /** Minor units as a decimal string. */
  amount_minor: string;
  currency: string;
  visibility: 'private' | 'group';
}

/**
 * One row of somebody's own category catalog (`category_tags`), as the
 * database stores it.
 *
 * Named apart from @waves/core's `CategoryTagRow`, which is the same data in
 * camelCase: a file that reads these and builds a catalog needs both, and two
 * types with one name is a rename waiting to happen.
 *
 * Two kinds in one table. A row with `builtin_id` set is an **override**: it
 * carries only where one of the ten built-ins sits and whether it is hidden —
 * the label stays in each client's own string table, so the person's Tamil
 * stays Tamil. A row without one is a **custom tag**, and its label is the
 * person's own words, never translated.
 *
 * Authorization is the row's own: the policy is `owner_user_id =
 * waves_current_profile_id()`, for reads and writes alike, so this table needs
 * no RPC in front of it.
 */
export interface CategoryTagRecord {
  id: string;
  owner_user_id: string;
  /** The built-in this row overrides, or null for a custom tag. */
  builtin_id: string | null;
  label: string | null;
  icon: string | null;
  tint: string | null;
  sort_order: number;
  hidden: boolean;
}

/**
 * What erasing this account would and would not remove.
 *
 * The counts exist so a screen can say the consequence before the button. The
 * ledger is the part that stays: an expense in a shared group is also other
 * people's record of what happened, and deleting it would silently change
 * somebody else's balance to settle a debt nobody paid.
 */
export interface ErasurePreview {
  groups_count: number;
  expenses_authored: number;
  settlements_involved: number;
  /** Currencies this person still has a non-zero balance in. */
  outstanding_currencies: string[];
}

/** How findable somebody is, and how much of them their groups can see. */
export interface DiscoverySettings {
  discoverableByPhone: boolean;
  discoverableByEmail: boolean;
  /**
   * `nobody` or `groups`. A constrained union, not a free string — the column
   * carries the same check, and the two must not be able to drift apart.
   */
  contactVisibility: 'nobody' | 'groups';
}

/** What an account starts as: findable, and visible to the groups it is in. */
export const DEFAULT_DISCOVERY: DiscoverySettings = {
  discoverableByPhone: true,
  discoverableByEmail: true,
  contactVisibility: 'groups',
};

/**
 * Read the stored visibility, erring towards the stricter answer.
 *
 * Anything the column somehow holds that is not one of the two known values
 * reads as `nobody`, never as `groups`. A privacy setting that fails open is not
 * a privacy setting, and "the check constraint prevents it" is an argument about
 * the database that this client cannot make on its own behalf.
 */
export function readContactVisibility(value: string | null | undefined): 'nobody' | 'groups' {
  return value === 'groups' ? 'groups' : 'nobody';
}

/**
 * What `waves_redeem_promo` answers with.
 *
 * Every wrong code comes back as a verdict rather than an exception, because
 * each one is a different sentence to say to somebody — expired is not the same
 * as already used, and neither is a crash. The only thing that raises is being
 * signed out, which is a bug in the caller.
 */
export type PromoOutcome =
  | { ok: true; tier: string; days: number; until: string }
  | { ok: false; reason: 'UNKNOWN_CODE' | 'EXPIRED' | 'EXHAUSTED' | 'ALREADY_REDEEMED' };

/**
 * A star, where somebody offered one.
 *
 * Narrow rather than `number` because the column carries a 1–5 check
 * constraint, and a range the type system already refuses cannot be sent by
 * accident from a control that miscounts.
 */
export type FeedbackRating = 1 | 2 | 3 | 4 | 5;

/** What somebody is saying, and which queue it belongs in. */
export interface FeedbackInput {
  message: string;
  kind: 'general' | 'bug' | 'idea';
  /** 1–5 where they offered one; null when they wrote without rating. */
  rating: FeedbackRating | null;
  /** The build they were on, or null where the deployment does not say. */
  appVersion: string | null;
  platform: string;
}
