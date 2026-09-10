/**
 * One client for anything that is not the phone.
 *
 * Framework-free on purpose: no React, no React Native, no Next. The app has
 * its own data layer built around an offline mirror and a mutation queue; a
 * browser opening a link has neither and does not want them. What the two
 * genuinely share is @waves/core — the split maths, the balances, the money
 * types — and that is where sharing stops being a convenience and starts being
 * a correctness requirement (TDR §1).
 *
 * Authorization is not here. Every read goes to PostgREST under the caller's
 * own session and every RLS policy applies unchanged (ADR-013); a guest who
 * accepted an invite sees exactly the group they joined, because that is what
 * the database says, not because this file remembered to filter. The one thing
 * that carries authority is the invite token, and that is checked server-side
 * in `invite-accept`.
 */

import type { Session, SupabaseClient } from '@supabase/supabase-js';

import {
  AuthMethod,
  buildExpenseWriteBody,
  checkPassword,
  planAuth,
  readIdentifier,
  type CategoryMeta,
  type ExpenseLocation,
  type FxRecord,
  type PaymentMethod,
  type Viewer,
} from '@waves/core';

import type { AcceptedInvite, Expense, Group, InvitePreview, Member, Settlement } from './types';
import {
  coarseMethod,
  type ActivityGroup,
  type ActivityRow,
  type BalanceRow,
  type DisputeRow,
  type ExpenseVersionSummary,
  type GroupRow,
  type GroupType,
  type ExportResult,
  type MemberRow,
  type PersonGroupBalanceRow,
  type ProfileRow,
  type NotificationRow,
  type PersonBalanceRow,
} from './rows';

const PROFILE_COLUMNS =
  'id, display_name, avatar_url, payment_rail, payment_handle, default_vpa, ' +
  'country_code, default_currency, locale, notification_prefs';

const GROUP_ROW_COLUMNS = `
  id, name, type, country_code, default_currency, simplify_debts, cover_emoji, photo_path,
  start_date, end_date, archived_at, created_at, updated_seq
`;

// profiles is embedded by its FK column (profile_id): ghost_merges references
// both group_members and profiles, so PostgREST sees two group_members↔profiles
// relationships and an unqualified embed fails ("more than one relationship").
const MEMBER_ROW_COLUMNS = `
  id, group_id, profile_id, ghost_name, role, vpa, payment_rail, payment_handle, left_at,
  profile:profiles!profile_id ( id, display_name, avatar_url, default_vpa, payment_rail, payment_handle )
`;

const ACTIVITY_COLUMNS = `
  id, group_id, actor_member_id, verb, object_type, object_id, payload, created_at,
  actor:group_members!activity_log_actor_member_id_fkey (
    id, profile_id, ghost_name, profile:profiles!profile_id ( display_name )
  )
`;

const MEMBER_COLUMNS = `
  id, group_id, profile_id, ghost_name, left_at, role,
  profile:profiles!profile_id ( display_name )
`;

const EXPENSE_COLUMNS = `
  id, group_id, deleted_at, created_at,
  currentVersion:expense_versions!expenses_current_version_id_fkey (
    id, version_no, description, category, expense_date, currency, amount,
    split_type, split_params, location,
    payers:expense_payers ( member_id, amount ),
    shares:expense_shares ( member_id, amount )
  )
`;

export interface WavesClientOptions {
  supabase: SupabaseClient;
}

export class WavesApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'WavesApiError';
  }
}

export function createWavesClient({ supabase }: WavesClientOptions) {
  /**
   * PostgREST answers "you may not see this" with an empty list, not an error
   * — that is RLS doing its job. Only a real failure throws.
   */
  async function read<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
    const { data, error } = await query;
    if (error) throw new WavesApiError(String((error as { message?: string }).message ?? error));
    return (data ?? []) as T[];
  }

  /**
   * Invoke an edge function with a JSON body. Typed as `object`, not
   * `Record<string, unknown>`, so a typed request-shape (e.g. the shared
   * `ExpenseWriteBody` from @waves/core) is accepted without an index signature;
   * `invoke` serialises it to JSON either way.
   */
  async function callFunction<T>(name: string, body: object): Promise<T> {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) throw await describeFunctionError(error);
    return data as T;
  }

  /**
   * A SECURITY DEFINER RPC. The table it writes is read-only to clients, so the
   * function is the only door and it checks the caller's right to knock — a
   * dispute filed under someone else's name, or a delete of an expense in a
   * group you are not in, is refused there, not here (ADR-013).
   */
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new WavesApiError(String((error as { message?: string }).message ?? error));
    return data as T;
  }

  return {
    /**
     * A guest is a real account with no credentials on it yet (ADR-006). It is
     * created before the invite is accepted so the membership has somebody to
     * belong to — and it is the *same* account they later add an email to, so
     * the group does not have to be re-joined and the history stays theirs.
     */
    async signInAsGuest(): Promise<void> {
      const { data } = await supabase.auth.getSession();
      if (data.session) return;
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw new WavesApiError(error.message);
    },

    /**
     * The real login (ADR-006 names Google among the upgrade providers). An
     * anonymous guest who does this keeps the same user id, so the groups and
     * expenses made as a guest come with them — Supabase links the identity in
     * place rather than minting a second account.
     *
     * Returns nothing useful: `signInWithOAuth` navigates the browser to
     * Google and control does not come back here — it comes back to
     * `redirectTo` with the session in the URL.
     */
    async signInWithGoogle(redirectTo: string): Promise<void> {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) throw new WavesApiError(error.message);
    },

    /**
     * The passwordless email login, matching the phone's approach: a link is
     * mailed, and clicking it returns to `redirectTo` (the callback route) with
     * a code this client exchanges for a session. No password to store, forget
     * or leak. Like Google, an anonymous guest who does this keeps their id and
     * their history.
     */
    async signInWithEmail(email: string, redirectTo: string): Promise<void> {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw new WavesApiError(error.message);
    },

    /**
     * Email (or phone) and a password. The one call this makes is decided by
     * `planAuth` in @waves/core, not here: a guest is upgraded **in place**
     * (ADR-006) with `updateUser` so the groups and money made as a guest come
     * with them, and only somebody with no account signs up or signs in fresh.
     * Getting that wrong strands a week of expenses on an account nobody can
     * reach — which is exactly why the choice is not left to the screen.
     *
     * `readIdentifier` and `checkPassword` throw `IdentityError` before any
     * round trip (bad address, too-short/too-common password); Supabase errors
     * become `WavesApiError`. Either way the caller shows the message.
     */
    async withPassword(
      identifier: string,
      password: string,
      intent: 'sign_in' | 'sign_up',
    ): Promise<void> {
      const who = readIdentifier(identifier);
      checkPassword(password);
      const method = who.kind === 'email' ? AuthMethod.EmailPassword : AuthMethod.PhonePassword;
      const credential = who.kind === 'email' ? { email: who.value } : { phone: who.value };

      const { data } = await supabase.auth.getSession();
      const viewer: Viewer = !data.session?.user
        ? { kind: 'nobody' }
        : data.session.user.is_anonymous === true
          ? { kind: 'guest', userId: data.session.user.id }
          : { kind: 'user', userId: data.session.user.id };
      const action = planAuth(viewer, method, intent);

      if (action.call === 'updateUser') {
        // The upgrade: same user id, so the groups stay put (ADR-006).
        const { error } = await supabase.auth.updateUser({ ...credential, password });
        if (error) throw new WavesApiError(error.message);
        return;
      }

      const { error } =
        action.call === 'signUp'
          ? await supabase.auth.signUp({ ...credential, password })
          : await supabase.auth.signInWithPassword({ ...credential, password });
      if (error) throw new WavesApiError(error.message);
    },

    async signOut(): Promise<void> {
      const { error } = await supabase.auth.signOut();
      if (error) throw new WavesApiError(error.message);
    },

    async session(): Promise<Session | null> {
      const { data } = await supabase.auth.getSession();
      return data.session;
    },

    /** True once a real identity is linked; a bare guest reads false. */
    async isGuest(): Promise<boolean> {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) return false;
      return user.is_anonymous === true;
    },

    /** Fires on sign-in / sign-out / token refresh. Returns an unsubscribe. */
    onAuthChange(handler: (session: Session | null) => void): () => void {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        handler(session);
      });
      return () => data.subscription.unsubscribe();
    },

    async currentProfileId(): Promise<string | null> {
      const { data } = await supabase.auth.getSession();
      return data.session?.user.id ?? null;
    },

    /** What is behind the link, without joining anything. */
    previewInvite(token: string): Promise<InvitePreview> {
      return callFunction<InvitePreview>('invite-accept', { token, mode: 'preview' });
    },

    /**
     * Joining. `claimMemberId` asks to take over a ghost somebody already
     * added, which is what keeps the expenses already filed against that name
     * (ADR-006) — without it the arrival becomes a second person and the group
     * has two of them.
     *
     * Asking is not joining: a claim comes back `pending` with no `memberId`
     * and waits on an admin of the group. Handing the place over on request
     * would let anybody holding the link inherit that name's whole history.
     */
    acceptInvite(input: {
      token: string;
      claimMemberId?: string | null;
      displayName?: string | null;
    }): Promise<AcceptedInvite> {
      return callFunction<AcceptedInvite>('invite-accept', { ...input, mode: 'join' });
    },

    async group(groupId: string): Promise<Group | null> {
      const rows = await read<Group>(
        supabase
          .from('groups')
          .select('id, name, cover_emoji, default_currency, simplify_debts')
          .eq('id', groupId)
          .limit(1),
      );
      return rows[0] ?? null;
    },

    members(groupId: string): Promise<Member[]> {
      return read<Member>(
        supabase
          .from('group_members')
          .select(MEMBER_COLUMNS)
          .eq('group_id', groupId)
          .is('left_at', null)
          .order('created_at', { ascending: true }),
      );
    },

    expenses(groupId: string): Promise<Expense[]> {
      return read<Expense>(
        supabase
          .from('expenses')
          .select(EXPENSE_COLUMNS)
          .eq('group_id', groupId)
          .order('created_at', { ascending: false }),
      );
    },

    /** One expense with its current version (payers and shares), or null. */
    async expense(expenseId: string): Promise<Expense | null> {
      const rows = await read<Expense>(
        supabase.from('expenses').select(EXPENSE_COLUMNS).eq('id', expenseId).limit(1),
      );
      return rows[0] ?? null;
    },

    /** The edit history of one expense, newest version first (ADR-004). */
    expenseVersions(expenseId: string): Promise<ExpenseVersionSummary[]> {
      return read<ExpenseVersionSummary>(
        supabase
          .from('expense_versions')
          .select(
            'id, version_no, description, amount, currency, created_at, author_member_id, split_type',
          )
          .eq('expense_id', expenseId)
          .order('version_no', { ascending: false }),
      );
    },

    /**
     * Soft-delete and its undo (ADR-004): the row stays, its balances stop
     * counting, and the history — and any restore — remains. Both go through an
     * RPC so the table itself never takes a client write.
     */
    deleteExpense(expenseId: string): Promise<void> {
      return rpc('waves_delete_expense', { p_expense_id: expenseId }).then(() => undefined);
    },

    restoreExpense(expenseId: string): Promise<void> {
      return rpc('waves_restore_expense', { p_expense_id: expenseId }).then(() => undefined);
    },

    // ─────────────────────────────────────── disputes (ADR-004) ──
    // A dispute is a claim, not a mutation: recorded and visible to everyone,
    // it moves no number until somebody edits the expense.

    disputes(groupId: string): Promise<DisputeRow[]> {
      return read<DisputeRow>(
        supabase
          .from('expense_disputes')
          .select(
            `id, expense_id, member_id, reason, status, resolved_by_member_id, resolution_note,
             created_at, resolved_at, expense:expenses!inner ( group_id )`,
          )
          .eq('expense.group_id', groupId)
          .order('created_at', { ascending: false }),
      );
    },

    async disputeExpense(input: { expenseId: string; reason?: string | null }): Promise<string> {
      return String(
        await rpc('waves_dispute_expense', {
          p_expense_id: input.expenseId,
          p_reason: input.reason?.trim() || null,
        }),
      );
    },

    withdrawDispute(expenseId: string): Promise<void> {
      return rpc('waves_withdraw_dispute', { p_expense_id: expenseId }).then(() => undefined);
    },

    /** Admin only (server-checked): accept means the expense needs fixing. */
    resolveDispute(input: {
      disputeId: string;
      accept: boolean;
      note?: string | null;
    }): Promise<void> {
      return rpc('waves_resolve_dispute', {
        p_dispute_id: input.disputeId,
        p_accept: input.accept,
        p_note: input.note?.trim() || null,
      }).then(() => undefined);
    },

    settlements(groupId: string): Promise<Settlement[]> {
      return read<Settlement>(
        supabase
          .from('settlements')
          .select(
            `id, group_id, from_member_id, to_member_id, currency, amount, status,
             initiated_at, confirmed_at,
             allocations:settlement_allocations ( expense_id, amount )`,
          )
          .eq('group_id', groupId)
          .order('initiated_at', { ascending: false }),
      );
    },

    // ───────────────────────────────────────────────────── dashboard ──
    // Every read here is unfiltered by group on purpose: RLS returns exactly
    // the rows this session may see (ADR-013), so "my groups" is "the groups"
    // and the client never guesses at membership.

    // A deleted group (A49) is a tombstone, not an archive: `waves_delete_group`
    // stamps `deleted_at` and leaves every row in place so the delete can travel
    // to other devices, and RLS goes on returning them to a member. So every
    // read of `groups` here has to say so — otherwise a deleted group comes back
    // looking exactly like a live one.
    myGroups(): Promise<GroupRow[]> {
      return read<GroupRow>(
        supabase
          .from('groups')
          .select(GROUP_ROW_COLUMNS)
          .is('archived_at', null)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
      );
    },

    /** Every group, archived ones included — the archive shelf reads this. */
    allGroups(): Promise<GroupRow[]> {
      return read<GroupRow>(
        supabase
          .from('groups')
          .select(GROUP_ROW_COLUMNS)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
      );
    },

    /** The whole row for one group, not the lean five columns `group` returns. */
    async groupRow(groupId: string): Promise<GroupRow | null> {
      const rows = await read<GroupRow>(
        supabase
          .from('groups')
          .select(GROUP_ROW_COLUMNS)
          .eq('id', groupId)
          .is('deleted_at', null)
          .limit(1),
      );
      return rows[0] ?? null;
    },

    /**
     * Start a group. The creator's membership is made by the RPC, not by a
     * second insert here: two round trips could leave a group nobody is in.
     *
     * A name is optional throughout Waves — a group with none is labelled by
     * who is in it — so an empty box is a choice, not a validation failure.
     */
    createGroup(input: {
      name?: string | null;
      type: GroupType;
      currency: string;
      emoji?: string | null;
      simplify?: boolean;
      country?: string | null;
    }): Promise<string> {
      return rpc<string>('waves_create_group', {
        p_name: input.name?.trim() || null,
        p_type: input.type,
        p_currency: input.currency,
        p_emoji: input.emoji ?? null,
        p_simplify: input.simplify ?? true,
        p_group_id: null,
        p_photo_path: null,
        p_country: input.country ?? null,
        p_creator_member_id: null,
      });
    },

    /**
     * Change the group itself. A plain table update, which is deliberate: RLS
     * decides who may write these columns, and `role` is not among them —
     * promoting somebody goes through `setMemberRole`, where the last-admin
     * rule lives.
     *
     * `ifUpdatedSeq` makes the write conditional on the row still being the one
     * that was read. A settings *form* needs this in a way a single switch does
     * not: it carries every field, so saving a form filled in ten minutes ago
     * would put its stale currency and name back over whatever another admin
     * changed in between — a silent revert of somebody else's work. A trigger
     * bumps `updated_seq` on every write to the group, so a row that no longer
     * matches is exactly "somebody got here first", and the caller is told with
     * a `stale_revision` code rather than being let through.
     */
    async updateGroup(
      groupId: string,
      patch: Partial<{
        name: string | null;
        type: GroupType;
        cover_emoji: string | null;
        simplify_debts: boolean;
        default_currency: string;
        country_code: string | null;
        archived_at: string | null;
        start_date: string | null;
        end_date: string | null;
      }>,
      options: { ifUpdatedSeq?: number } = {},
    ): Promise<void> {
      const query = supabase.from('groups').update(patch).eq('id', groupId);
      if (options.ifUpdatedSeq === undefined) {
        const { error } = await query;
        if (error)
          throw new WavesApiError(String((error as { message?: string }).message ?? error));
        return;
      }

      // `select` is what makes the result countable: without it PostgREST
      // returns no rows and a write that matched nothing is indistinguishable
      // from one that matched.
      const { data, error } = await query.eq('updated_seq', options.ifUpdatedSeq).select('id');
      if (error) throw new WavesApiError(String((error as { message?: string }).message ?? error));
      if (!data || (data as unknown[]).length === 0) {
        throw new WavesApiError('The group changed since it was opened.', 'stale_revision');
      }
    },

    /**
     * Delete a group for everybody. A tombstone rather than a row delete — the
     * ledger stays append-only (ADR-004) — and admin-only and settled-only are
     * enforced inside the RPC, so the two coded refusals below are what the
     * caller turns into a sentence.
     */
    deleteGroup(groupId: string): Promise<void> {
      return rpc<void>('waves_delete_group', { p_group_id: groupId });
    },

    /**
     * Add somebody who is not here yet: a name in the group, with expenses
     * filed against it, that a real person can later claim through an invite
     * (ADR-006). The contact is a hint for one invitation, never a contact book.
     */
    addGhostMember(input: {
      groupId: string;
      name: string;
      email?: string | null;
      phone?: string | null;
    }): Promise<string> {
      return rpc<string>('waves_add_ghost_member', {
        p_group_id: input.groupId,
        p_name: input.name.trim() || null,
        p_member_id: null,
        p_email: input.email?.trim() || null,
        p_phone: input.phone?.trim() || null,
      });
    },

    /** Rename a ghost, or set your own per-group payment handle. */
    async updateMember(
      memberId: string,
      patch: Partial<{ ghost_name: string; vpa: string | null }>,
    ): Promise<void> {
      const { error } = await supabase.from('group_members').update(patch).eq('id', memberId);
      if (error) throw new WavesApiError(String((error as { message?: string }).message ?? error));
    },

    /**
     * Promote or demote. Never a column a client writes: admin-only and the
     * last-admin guard live in the RPC, and a trigger refuses the direct route.
     */
    setMemberRole(memberId: string, role: 'admin' | 'member'): Promise<void> {
      return rpc<void>('waves_set_member_role', { p_member_id: memberId, p_role: role });
    },

    /** A soft exit: the history stays, the person stops accruing new shares. */
    async leaveGroup(memberId: string): Promise<void> {
      const { error } = await supabase
        .from('group_members')
        .update({ left_at: new Date().toISOString() })
        .eq('id', memberId);
      if (error) throw new WavesApiError(String((error as { message?: string }).message ?? error));
    },

    /**
     * The group's durable join token, made on first use (A47).
     *
     * One stable token per group — the WhatsApp model — so the same link and QR
     * can be shown again tomorrow rather than minting a fresh invite per person.
     */
    ensureGroupJoinToken(groupId: string): Promise<string> {
      return rpc<string>('waves_ensure_group_join_token', { p_group_id: groupId });
    },

    /** Rotate it. Admin only, and every copy already shared stops working. */
    resetGroupJoinToken(groupId: string): Promise<string> {
      return rpc<string>('waves_reset_group_join_token', { p_group_id: groupId });
    },

    /** Every member of every group I am in, keyed by group — one query. */
    async membersByGroup(): Promise<Map<string, MemberRow[]>> {
      const rows = await read<MemberRow>(
        supabase
          .from('group_members')
          .select(MEMBER_ROW_COLUMNS)
          .is('left_at', null)
          .order('created_at', { ascending: true }),
      );
      const byGroup = new Map<string, MemberRow[]>();
      for (const row of rows) {
        const list = byGroup.get(row.group_id);
        if (list) list.push(row);
        else byGroup.set(row.group_id, [row]);
      }
      return byGroup;
    },

    /** Just my own balance in each group — the one query the dashboard needs. */
    async myBalances(profileId: string): Promise<BalanceRow[]> {
      const rows = await read<BalanceRow & { member: { profile_id: string } }>(
        supabase
          .from('group_balances')
          .select(
            'group_id, member_id, currency, balance, member:group_members!inner ( profile_id )',
          )
          .eq('member.profile_id', profileId),
      );
      return rows.map(({ member: _member, ...row }) => row);
    },

    /** Every balance in every group I can see — for per-group nets. */
    allBalances(): Promise<BalanceRow[]> {
      return read<BalanceRow>(
        supabase.from('group_balances').select('group_id, member_id, currency, balance'),
      );
    },

    /** Activity across every group I can see; RLS does the filtering. */
    recentActivity(limit = 60): Promise<(ActivityRow & { group: ActivityGroup | null })[]> {
      return read<ActivityRow & { group: ActivityGroup | null }>(
        supabase
          .from('activity_log')
          .select(`${ACTIVITY_COLUMNS}, group:groups ( id, name, cover_emoji )`)
          .order('created_at', { ascending: false })
          .limit(limit),
      );
    },

    /** Groups with a settlement still waiting on someone to confirm (ADR-007). */
    pendingSettlements(): Promise<{ group_id: string; id: string }[]> {
      return read<{ group_id: string; id: string }>(
        supabase.from('settlements').select('id, group_id').eq('status', 'initiated'),
      );
    },

    /** Every person you are not square with, across every group, per currency. */
    peopleBalances(): Promise<PersonBalanceRow[]> {
      return read<PersonBalanceRow>(supabase.rpc('waves_people_i_owe'));
    },

    // ─────────────────────────────────────────────── settling up (ADR-007) ──
    // Recording a settlement is not performing it: the ledger tracks what people
    // say they paid, made real only when whoever was paid confirms it. Every
    // write is a SECURITY DEFINER RPC — the settlements table takes no client
    // write — and the server recomputes nothing it was handed.

    /**
     * "I paid them." The coarse `method` enum is derived server-side from the
     * finer rail, so a rail the enum never heard of still records rather than
     * being refused.
     *
     * `clientMutationId` is what makes a double-tapped Save harmless, and it is
     * required rather than defaulted here on purpose: a key minted inside this
     * call would be a *new* key on every retry, so the server would dedup
     * nothing and a flaky-network retry would record the payment twice. The
     * caller owns the key so it can hold one stable value across retries of the
     * same settlement and mint a fresh one only once a payment has recorded.
     */
    async recordSettlement(input: {
      groupId: string;
      fromMemberId: string;
      toMemberId: string;
      amount: bigint;
      /** A `RailId` from @waves/core — `upi`, `pix`, `cash`, … */
      rail: string;
      currency?: string | null;
      note?: string | null;
      allocations?: { expenseId: string; amount: bigint }[];
      /** Stable across retries of the same settlement; the server dedups on it. */
      clientMutationId: string;
    }): Promise<string> {
      return String(
        await rpc('waves_record_settlement', {
          p_group_id: input.groupId,
          p_from_member_id: input.fromMemberId,
          p_to_member_id: input.toMemberId,
          p_amount: input.amount.toString(),
          p_method: coarseMethod(input.rail),
          p_rail: input.rail,
          p_currency: input.currency ?? null,
          p_note: input.note?.trim() || null,
          p_allocations: (input.allocations ?? []).map((allocation) => ({
            expenseId: allocation.expenseId,
            amount: allocation.amount.toString(),
          })),
          p_client_mutation_id: input.clientMutationId,
        }),
      );
    },

    /** "Yes, that reached me." Only the payee may confirm (server-checked). */
    confirmSettlement(settlementId: string): Promise<void> {
      return rpc('waves_confirm_settlement', { p_settlement_id: settlementId }).then(
        () => undefined,
      );
    },

    /** A gentle poke to someone who owes you in a currency (ADR-010 prefs apply). */
    nudgeToSettle(input: { groupId: string; toMemberId: string; currency: string }): Promise<void> {
      return rpc('waves_nudge_to_settle', {
        p_group_id: input.groupId,
        p_to_member_id: input.toMemberId,
        p_currency: input.currency,
      }).then(() => undefined);
    },

    // ─────────────────────────────────────────────────────── the inbox ──
    // Everything Waves has told this person, kept whether or not a push ever
    // landed. No profile filter: `notifications_select_own` decides whose inbox
    // this is, and a second, weaker check here would only invite disagreement.

    /**
     * The signed-in person's own profile row.
     *
     * Read by id rather than "the one row RLS returns", because RLS lets you
     * see other people you share a group with — a `.single()` over the table
     * would be a coin toss about whose name the settings page edits.
     */
    async myProfile(): Promise<ProfileRow | null> {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id;
      if (!id) return null;
      const rows = await read<ProfileRow>(
        supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).limit(1),
      );
      return rows[0] ?? null;
    },

    /** Change your own row. RLS makes "your own" the only row this can touch. */
    async updateProfile(patch: Partial<ProfileRow>): Promise<void> {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id;
      if (!id) throw new WavesApiError('Not signed in');
      const { error } = await supabase.from('profiles').update(patch).eq('id', id);
      if (error) throw new WavesApiError(String((error as { message?: string }).message ?? error));
    },

    /**
     * Where one person's money actually sits: their balance per group, before
     * the Friends list nets it into a single number per currency.
     */
    async personGroupBalances(personKey: string): Promise<PersonGroupBalanceRow[]> {
      const rows = await rpc<PersonGroupBalanceRow[] | null>('waves_person_group_balances', {
        p_person_key: personKey,
      });
      return rows ?? [];
    },

    /**
     * Take the ledger away (ADR-012). The file is built server-side so the
     * browser and the phone produce the same bytes for the same data, rather
     * than each inventing a CSV dialect.
     */
    exportData(input: {
      groupId?: string;
      format: 'json' | 'csv' | 'pdf';
      csvSeparator?: string;
    }): Promise<ExportResult> {
      return callFunction<ExportResult>('export-data', input);
    },

    notifications(limit = 50): Promise<NotificationRow[]> {
      return read<NotificationRow>(
        supabase
          .from('notifications')
          .select('id, group_id, kind, title, body, deep_link, payload, read_at, created_at')
          .order('created_at', { ascending: false })
          .limit(limit),
      );
    },

    async markNotificationsRead(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      return Number(await rpc('waves_mark_notifications_read', { p_ids: ids }));
    },

    /**
     * Writing an expense goes through the edge function, never straight to a
     * table. The server recomputes every share from the parameters and writes
     * its own answer; the client's numbers are a claim to be checked, not an
     * instruction (TDR §4). That rule does not relax because the caller is a
     * browser.
     */
    writeExpense(input: WriteExpenseInput): Promise<WriteExpenseResult> {
      // One shared body builder (`buildExpenseWriteBody` in @waves/core), the
      // same one the mobile client and — via the edge — `/sync` use, so a write
      // from the browser carries every field the others do. It used to drop
      // paymentMethod, categoryMeta, fx and baseVersionNo even when a caller
      // supplied them; the split params arrive already in wire form here.
      return callFunction<WriteExpenseResult>(
        'expense-write',
        buildExpenseWriteBody({
          groupId: input.groupId,
          expenseId: input.expenseId,
          description: input.description,
          category: input.category ?? null,
          expenseDate: input.expenseDate,
          currency: input.currency,
          amount: input.amount,
          splitParams: input.splitParams,
          participants: input.participants,
          payers: input.payers,
          expectedShares: input.expectedShares,
          notes: input.notes ?? null,
          paymentMethod: input.paymentMethod ?? null,
          categoryMeta: input.categoryMeta ?? null,
          location: input.location ?? null,
          receiptShareUrl: input.receiptShareUrl ?? null,
          receiptId: input.receiptId ?? null,
          fx: input.fx ?? null,
          baseVersionNo: input.baseVersionNo ?? null,
          // The idempotency key. A guest on a flaky phone browser is exactly who
          // double-taps Save, and this is what makes the second one harmless.
          clientMutationId: input.clientMutationId,
        }),
      );
    },
  };
}

export type WavesClient = ReturnType<typeof createWavesClient>;

export interface WriteExpenseInput {
  groupId: string;
  expenseId?: string;
  description: string;
  category?: string | null;
  expenseDate: string;
  currency: string;
  amount: bigint;
  /** Already in wire form — use `serialiseSplitParams` from @waves/core. */
  splitParams: unknown;
  participants: string[];
  payers: Record<string, bigint>;
  expectedShares?: Record<string, bigint>;
  notes?: string | null;
  /** How the money moved: cash | upi | credit | debit | forex. */
  paymentMethod?: PaymentMethod | null;
  /** Denormalised custom-tag display (extends TDR §8); null for a built-in. */
  categoryMeta?: CategoryMeta | null;
  /** Where the spend happened (A43); null unless the person opted in. The edge
   *  function validates it to Earth's ranges before it is stored. */
  location?: ExpenseLocation | null;
  /** A view-only link to the owner's own cloud copy of the receipt (E3). */
  receiptShareUrl?: string | null;
  /** Links a scanned receipt (ADR-008) to this expense; null when none. */
  receiptId?: string | null;
  /** The rate used when the expense is not in the group's currency (ADR-003). */
  fx?: FxRecord | null;
  /** The version this edit is based on (ADR-004 / TDR §4.4); set only for an
   *  edit, so the server can detect a concurrent edit instead of overwriting. */
  baseVersionNo?: number | null;
  clientMutationId: string;
}

export interface WriteExpenseResult {
  expenseId: string;
  versionId: string;
  versionNo: number;
  replayed?: boolean;
}

/**
 * Supabase wraps a non-2xx response, so the server's own message is one layer
 * down. Surfacing "This link has expired" instead of "Edge Function returned a
 * non-2xx status code" is the difference between a person knowing what to do
 * and filing a bug.
 */
async function describeFunctionError(error: unknown): Promise<WavesApiError> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { code?: string; message?: string };
      if (body?.message) return new WavesApiError(body.message, body.code);
    } catch {
      /* not JSON; fall through */
    }
  }
  return new WavesApiError(error instanceof Error ? error.message : String(error));
}
