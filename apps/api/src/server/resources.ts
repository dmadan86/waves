/**
 * The public shape of a Waves object.
 *
 * A row is not a resource. The tables carry columns that exist for the offline
 * mirror (`updated_seq`), for a screen that does not exist outside the app
 * (`photo_path`, `vpa`), and for history the API has no business publishing.
 * Everything a third party sees passes through this file, so widening the
 * contract is a deliberate edit here rather than a column somebody added to a
 * table one afternoon.
 *
 * Two conventions, both load-bearing:
 *
 * **Money is a decimal string of minor units, always beside its currency.**
 * A JSON number cannot hold ₹92,233,720,368,547,758.08 and, worse, will
 * silently round on the way past. The app, the edge functions and the database
 * have all agreed on integer minor units since ADR-003; a public API is exactly
 * the wrong place to start being loose about it.
 *
 * **Names are snake_case**, matching the database and every other ledger API a
 * developer will have integrated with.
 */

import type {
  BalanceRow,
  Expense,
  GroupRow,
  MemberRow,
  PersonBalanceRow,
  ProfileRow,
  Settlement,
} from '@waves/api-client';

export interface UserResource {
  id: string;
  display_name: string;
  avatar_url: string | null;
  default_currency: string;
  country_code: string | null;
  locale: string;
  payment_rail: string | null;
  payment_handle: string | null;
}

export function toUser(row: ProfileRow): UserResource {
  return {
    id: row.id,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    default_currency: row.default_currency,
    country_code: row.country_code,
    locale: row.locale,
    payment_rail: row.payment_rail,
    payment_handle: row.payment_handle,
  };
}

export interface GroupResource {
  id: string;
  name: string | null;
  type: string;
  default_currency: string;
  country_code: string | null;
  simplify_debts: boolean;
  cover_emoji: string | null;
  start_date: string | null;
  end_date: string | null;
  archived_at: string | null;
  created_at: string;
  /**
   * The row's revision. Send it back as `if_revision` on an update and a
   * concurrent edit is refused rather than silently overwritten — the same
   * guard the settings form in the app uses, exposed because a script editing a
   * group has exactly the same problem and no way to notice it.
   */
  revision: number;
}

export function toGroup(row: GroupRow): GroupResource {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    default_currency: row.default_currency,
    country_code: row.country_code,
    simplify_debts: row.simplify_debts,
    cover_emoji: row.cover_emoji,
    start_date: row.start_date,
    end_date: row.end_date,
    archived_at: row.archived_at,
    created_at: row.created_at,
    revision: Number(row.updated_seq),
  };
}

export interface MemberResource {
  id: string;
  group_id: string;
  /** Null for a ghost — somebody named in the group who has no account yet. */
  user_id: string | null;
  name: string | null;
  role: 'admin' | 'member';
  is_ghost: boolean;
  left_at: string | null;
}

export function toMember(row: MemberRow): MemberResource {
  return {
    id: row.id,
    group_id: row.group_id,
    user_id: row.profile_id,
    name: row.profile?.display_name ?? row.ghost_name,
    role: row.role ?? 'member',
    is_ghost: row.profile_id === null,
    left_at: row.left_at,
  };
}

export interface BalanceResource {
  member_id: string;
  currency: string;
  /** Positive: this member is owed. Negative: they owe. Minor units. */
  amount: string;
}

export function toBalance(row: BalanceRow): BalanceResource {
  return { member_id: row.member_id, currency: row.currency, amount: String(row.balance) };
}

export interface ExpenseResource {
  id: string;
  group_id: string;
  description: string;
  category: string | null;
  expense_date: string;
  currency: string;
  amount: string;
  split_type: string;
  payers: { member_id: string; amount: string }[];
  shares: { member_id: string; amount: string }[];
  location: { lat: number; lng: number; name?: string | null } | null;
  /**
   * Which edit this is. Waves keeps every version of an expense (ADR-004), and
   * an update must say which one it is based on or it can quietly undo somebody
   * else's edit — so this is not decoration, it is the input to the next write.
   */
  version_no: number;
  deleted_at: string | null;
  created_at: string;
}

export function toExpense(row: Expense): ExpenseResource | null {
  const version = row.currentVersion;
  // An expense with no current version is a row mid-write, not a resource. RLS
  // can also return the shell without the version if the version is not
  // readable, and half an expense is worse than none.
  if (!version) return null;
  return {
    id: row.id,
    group_id: row.group_id,
    description: version.description,
    category: version.category,
    expense_date: version.expense_date,
    currency: version.currency,
    amount: String(version.amount),
    split_type: version.split_type,
    payers: version.payers.map((payer) => ({
      member_id: payer.member_id,
      amount: String(payer.amount),
    })),
    shares: version.shares.map((share) => ({
      member_id: share.member_id,
      amount: String(share.amount),
    })),
    location: version.location ?? null,
    version_no: version.version_no,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
  };
}

export interface SettlementResource {
  id: string;
  group_id: string;
  from_member_id: string;
  to_member_id: string;
  currency: string;
  amount: string;
  /** initiated | confirmed | auto_confirmed | disputed | cancelled (ADR-007). */
  status: string;
  initiated_at: string;
  confirmed_at: string | null;
}

export function toSettlement(row: Settlement): SettlementResource {
  return {
    id: row.id,
    group_id: row.group_id,
    from_member_id: row.from_member_id,
    to_member_id: row.to_member_id,
    currency: row.currency,
    amount: String(row.amount),
    status: row.status,
    initiated_at: row.initiated_at,
    confirmed_at: row.confirmed_at,
  };
}

export interface FriendResource {
  /** Stable across groups: a real account's id, or a merged ghost's key. */
  person_key: string;
  user_id: string | null;
  display_name: string;
  avatar_url: string | null;
  is_ghost: boolean;
  currency: string;
  /** Positive: they owe you. Negative: you owe them. Minor units. */
  net: string;
  group_count: number;
}

export function toFriend(row: PersonBalanceRow): FriendResource {
  return {
    person_key: row.person_key,
    user_id: row.profile_id,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    is_ghost: row.is_ghost,
    currency: row.currency,
    net: String(row.net),
    group_count: row.group_count,
  };
}

export interface CategoryResource {
  id: string;
  /** Null for a custom tag; the built-in id this row overrides otherwise. */
  builtin_id: string | null;
  label: string | null;
  icon: string | null;
  tint: string | null;
  axis: string;
  sort_order: number;
  hidden: boolean;
}

export interface CategoryTagRow {
  id: string;
  builtin_id: string | null;
  label: string | null;
  icon: string | null;
  tint: string | null;
  axis: string;
  sort_order: number;
  hidden: boolean;
}

export function toCategory(row: CategoryTagRow): CategoryResource {
  return {
    id: row.id,
    builtin_id: row.builtin_id,
    label: row.label,
    icon: row.icon,
    tint: row.tint,
    axis: row.axis,
    sort_order: row.sort_order,
    hidden: row.hidden,
  };
}
