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
  OAuthMethod,
  planAuth,
  readIdentifier,
  sanitizeCommentMarkdown,
  type CategoryMeta,
  type ExpenseLocation,
  type FxRecord,
  type PaymentMethod,
  type DeviceSession,
  type Viewer,
} from '@waves/core';

import type { AcceptedInvite, Expense, Group, InvitePreview, Member, Settlement } from './types';
import {
  coarseMethod,
  type ActivityGroup,
  type ActivityRow,
  type BalanceRow,
  type DisputeRow,
  type ExpenseAttachment,
  type ExpenseComment,
  type ExpenseImageEvent,
  type ExpenseVersionSummary,
  type Receipt,
  type GroupRow,
  type GroupType,
  type ExportResult,
  type MemberRow,
  type PersonGroupBalanceRow,
  type ProfileRow,
  type NotificationRow,
  type PersonBalanceRow,
  type PlanItemRow,
  type MemberBudgetRow,
  type CategoryTagRecord,
  type ErasurePreview,
  DEFAULT_DISCOVERY,
  readContactVisibility,
  type DiscoverySettings,
} from './rows';

const PROFILE_COLUMNS =
  'id, display_name, avatar_url, payment_rail, payment_handle, default_vpa, ' +
  'country_code, default_currency, locale, notification_prefs';

const GROUP_ROW_COLUMNS = `
  id, name, type, country_code, default_currency, simplify_debts, cover_emoji, photo_path,
  start_date, end_date, time_zone, budget_minor, budget_currency,
  archived_at, created_at, updated_seq
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

/** How long a signed image URL lives. Matches the phone's. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const EXPENSE_COLUMNS = `
  id, group_id, deleted_at, created_at,
  currentVersion:expense_versions!expenses_current_version_id_fkey (
    id, version_no, description, category, category_meta, expense_date, currency, amount,
    split_type, split_params, location, receipt_id, receipt_share_url,
    payers:expense_payers ( member_id, amount ),
    shares:expense_shares ( member_id, amount )
  )
`;

const PLAN_ITEM_COLUMNS = `
  id, group_id, day, starts_at, title, note, category, planned_minor, currency,
  done_at, expense_id, position
`;

export interface WavesClientOptions {
  supabase: SupabaseClient;
  /**
   * Whether images live in R2 (A44). Passed in rather than read from the
   * environment: the phone spells its flag `EXPO_PUBLIC_R2_ENABLED` and the web
   * `NEXT_PUBLIC_R2_ENABLED`, and a shared package should not have to know
   * either. Off means the old Supabase Storage path, which is what production
   * still runs.
   */
  r2Enabled?: boolean;
}

/**
 * Why an identity token was refused: somebody is already signed in, and
 * attaching Google to *them* is a link, which only the redirect flow can do.
 *
 * Exported because the sign-in screen matches on it to fall back quietly —
 * this is the one rejection that is not worth showing anybody.
 */
export const GOOGLE_CREDENTIAL_NEEDS_REDIRECT = 'google_credential_needs_redirect';

export class WavesApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'WavesApiError';
  }
}

export function createWavesClient({ supabase, r2Enabled = false }: WavesClientOptions) {
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

  /**
   * Who is signed in right now, in the shape @waves/core's `planAuth` reads.
   *
   * Asked fresh each time rather than remembered. Between one button and the
   * next an invite link opened in another tab may have minted a guest, and a
   * stale `nobody` here is the whole difference between upgrading that account
   * and quietly replacing it.
   */
  async function currentViewer(): Promise<Viewer> {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return { kind: 'nobody' };
    return user.is_anonymous === true
      ? { kind: 'guest', userId: user.id }
      : { kind: 'user', userId: user.id };
  }

  /**
   * Start a provider sign-in — and make it the *right* one.
   *
   * This was a single `signInWithOAuth` for a long time, whatever the session.
   * On the sign-in card that is correct, because there is nobody to lose. On
   * the two places the web client actually offers it — the guest banner and
   * the guest panel in settings, both of which say in so many words that
   * signing in is how you keep what you have — it was exactly backwards.
   * `signInWithOAuth` under an anonymous session does not attach the provider
   * to that account; it signs into a different one. The guest's groups are not
   * deleted, they are simply somebody else's now, and the anonymous session
   * that was the only route back has just been overwritten. Nothing errors,
   * and nothing on screen suggests anything happened at all.
   *
   * So the choice is not made here. `planAuth` makes it — @waves/core sets out
   * why at length — and this performs it: `linkIdentity` for anybody already
   * signed in, guest or not, and `signInWithOAuth` only for nobody.
   *
   * Both navigate the browser away, so there is no success to return. Note
   * what that costs the caller, because it is not obvious: `linkIdentity`
   * comes back to `redirectTo` with **no code**, since the session it just
   * attached an identity to is the one already in this browser. A callback
   * route that reads an empty redirect as a failure will therefore report an
   * error on the one path that worked.
   */
  async function startOAuth(method: OAuthMethod, redirectTo: string): Promise<void> {
    const isGoogle = method === OAuthMethod.Google;
    const action = planAuth(await currentViewer(), isGoogle ? AuthMethod.Google : AuthMethod.Apple);
    // A string enum is nominal to TypeScript and supabase-js wants its own
    // `Provider` union, so the one crossing between the two lives here.
    const provider = isGoogle ? 'google' : 'apple';
    const { error } =
      action.call === 'linkIdentity'
        ? await supabase.auth.linkIdentity({ provider, options: { redirectTo } })
        : await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) throw new WavesApiError(error.message);
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
     * expenses made as a guest come with them — which is `startOAuth`'s doing,
     * not something Supabase arranges on its own.
     *
     * Returns nothing useful: the call navigates the browser to Google, and
     * control does not come back here — it comes back to `redirectTo`.
     */
    async signInWithGoogle(redirectTo: string): Promise<void> {
      await startOAuth(OAuthMethod.Google, redirectTo);
    },

    /**
     * The same door, without leaving the page.
     *
     * `signInWithGoogle` above is a redirect: the browser goes to Supabase's
     * own domain, then to Google, then back. It works, and somebody watching
     * the address bar sees a hostname that is neither ours nor Google's on the
     * way to their own account. Google Identity Services avoids the whole trip
     * — its button or One Tap returns an **identity token** in the page, and
     * that token is what this exchanges. Nothing navigates; on success the
     * session simply exists.
     *
     * Two things this deliberately refuses to do.
     *
     * **It will not touch an existing session.** `signInWithIdToken` has no
     * `linkIdentity` form, so for a guest it would do precisely the damage
     * `startOAuth` exists to prevent (ADR-006): sign into a *different*
     * account and overwrite the anonymous session that was the only way back
     * to the first. `planAuth` is asked, and anything other than a plain
     * sign-in is refused here rather than handled — the caller has the
     * redirect flow, which links correctly, and is expected to use it.
     *
     * **It does not generate the nonce.** Google must be given the SHA-256 of
     * it before the token exists, so the pair is made where the sheet is
     * configured and the raw half is passed back here. Supabase hashes this
     * and compares, which is what stops a token obtained by some other site
     * from being a sign-in to Waves.
     */
    async signInWithGoogleCredential(idToken: string, nonce: string): Promise<void> {
      const action = planAuth(await currentViewer(), AuthMethod.Google);
      if (action.call !== 'signInWithOAuth') {
        throw new WavesApiError(GOOGLE_CREDENTIAL_NEEDS_REDIRECT);
      }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
        nonce,
      });
      if (error) throw new WavesApiError(error.message);
    },

    /**
     * The same door, through Apple.
     *
     * On a phone this is Apple's own sheet and an identity token
     * (`appleNativeSignIn` in the app); a browser has no sheet, so it is the
     * ordinary redirect Google already uses. Apple answers that one with
     * `response_mode=form_post` to Supabase's own `/auth/v1/callback`, which
     * then sends the browser on to `redirectTo` carrying the same one-time
     * code — so nothing downstream of here has to know which provider it was.
     *
     * One thing genuinely differs, and it stays invisible until somebody's
     * name is blank: Apple hands over a display name on the **first**
     * authorization only, and on the web that name is posted to Supabase
     * rather than to this client. There is no web equivalent of the app's
     * `persistAppleName`, and no second authorization to recover it from, so
     * somebody whose very first Waves sign-in was Apple-in-a-browser arrives
     * with a name still to fill in.
     */
    async signInWithApple(redirectTo: string): Promise<void> {
      await startOAuth(OAuthMethod.Apple, redirectTo);
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

      const action = planAuth(await currentViewer(), method, intent);

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
          .select('id, name, type, cover_emoji, default_currency, simplify_debts')
          .eq('id', groupId)
          // Null for a deleted group rather than a row that opens: RLS still
          // returns it to a member, because the tombstone has to reach every
          // device (ADR-004), so the caller has to ask.
          .is('deleted_at', null)
          .limit(1),
      );
      return rows[0] ?? null;
    },

    /** Who is in the group now. Somebody who left is not offered a share of it. */
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

    /**
     * Everybody who has ever been in the group, departed members included.
     *
     * For reading the past rather than editing the present. The ledger keeps
     * member ids, not name snapshots, so a history resolved against the current
     * roster calls whoever has since left "Someone" — on the one screen whose
     * job is saying who did what. The RLS policy is membership of the group,
     * not the reader's own standing in it, so these rows are readable.
     */
    allMembers(groupId: string): Promise<Member[]> {
      return read<Member>(
        supabase
          .from('group_members')
          .select(MEMBER_COLUMNS)
          .eq('group_id', groupId)
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

    /**
     * The trip's plan, live rows only.
     *
     * A soft-deleted row is a tombstone the phone's sync needs in order to
     * propagate the deletion (ADR-005). A browser has no mirror to propagate
     * anything into, so it asks for what is still there.
     */
    planItems(groupId: string): Promise<PlanItemRow[]> {
      return read<PlanItemRow>(
        supabase
          .from('trip_plan_items')
          .select(PLAN_ITEM_COLUMNS)
          .eq('group_id', groupId)
          .is('deleted_at', null)
          .order('day', { ascending: true })
          .order('position', { ascending: true }),
      );
    },

    /**
     * Add something to a day.
     *
     * The id is minted by the caller, not the server, so that a retry after a
     * dropped connection replays as the same row rather than posting a second
     * one (ADR-005). The phone does this because it queues writes; the browser
     * does it because a click can outlive the request it started.
     */
    async addPlanItem(input: {
      groupId: string;
      day: string;
      title: string;
      startsAt?: string | null;
      note?: string | null;
      plannedMinor?: bigint | null;
      currency?: string | null;
      itemId: string;
    }): Promise<string> {
      return rpc<string>('waves_add_plan_item', {
        p_group_id: input.groupId,
        p_day: input.day,
        p_title: input.title,
        p_starts_at: input.startsAt ?? null,
        p_note: input.note ?? null,
        p_category: null,
        p_planned_minor: input.plannedMinor?.toString() ?? null,
        p_currency: input.currency ?? null,
        p_item_id: input.itemId,
      });
    },

    /**
     * Every trip budget in this group the caller is allowed to see.
     *
     * A cleared budget is a soft-delete tombstone the phone's sync needs; a
     * browser wants only the live ones.
     */
    memberBudgets(groupId: string): Promise<MemberBudgetRow[]> {
      return read<MemberBudgetRow>(
        supabase
          .from('trip_member_budgets')
          .select('id, group_id, member_id, amount_minor, currency, visibility')
          .eq('group_id', groupId)
          .is('deleted_at', null),
      );
    },

    /** Set the caller's own ceiling, and whether the group gets to see it. */
    async setMyTripBudget(input: {
      groupId: string;
      amountMinor: bigint;
      currency?: string | null;
      visibility: 'private' | 'group';
    }): Promise<void> {
      await rpc<null>('waves_set_my_trip_budget', {
        p_group_id: input.groupId,
        p_amount_minor: input.amountMinor.toString(),
        p_currency: input.currency ?? null,
        p_visibility: input.visibility,
      });
    },

    async clearMyTripBudget(groupId: string): Promise<void> {
      await rpc<null>('waves_clear_my_trip_budget', { p_group_id: groupId });
    },

    /**
     * The whole trip's cap. Admin only — enforced in the RPC, not here. A null
     * amount clears it.
     */
    async setGroupBudget(input: {
      groupId: string;
      amountMinor: bigint | null;
      currency?: string | null;
    }): Promise<void> {
      await rpc<null>('waves_set_group_budget', {
        p_group_id: input.groupId,
        p_amount_minor: input.amountMinor === null ? null : input.amountMinor.toString(),
        p_currency: input.currency ?? null,
      });
    },

    /** Tick it off, or un-tick it. Done means somebody did the thing, not paid for it. */
    async setPlanItemDone(itemId: string, done: boolean): Promise<void> {
      await rpc<null>('waves_update_plan_item', { p_item_id: itemId, p_done: done });
    },

    async removePlanItem(itemId: string): Promise<void> {
      await rpc<null>('waves_remove_plan_item', { p_item_id: itemId });
    },

    /** One expense with its current version (payers and shares), or null. */
    async expense(expenseId: string): Promise<Expense | null> {
      const rows = await read<Expense>(
        supabase.from('expenses').select(EXPENSE_COLUMNS).eq('id', expenseId).limit(1),
      );
      return rows[0] ?? null;
    },

    /**
     * The edit history of one expense, newest version first (ADR-004).
     *
     * Every field the audit compares comes back, payers and shares included:
     * the history's job is to say *what* changed, and a projection that stops
     * at the total cannot tell "₹100 moved from Asha to Ravi" from "nothing
     * happened".
     */
    expenseVersions(expenseId: string): Promise<ExpenseVersionSummary[]> {
      return read<ExpenseVersionSummary>(
        supabase
          .from('expense_versions')
          .select(
            'id, version_no, description, amount, currency, created_at, author_member_id, ' +
              'split_type, category, category_meta, expense_date, location, ' +
              'payers:expense_payers ( member_id, amount ), ' +
              'shares:expense_shares ( member_id, amount )',
          )
          .eq('expense_id', expenseId)
          .order('version_no', { ascending: false }),
      );
    },

    /**
     * The image audit for one expense, oldest first (A46).
     *
     * Party-only lines simply do not come back for somebody who is not on the
     * bill — the policy decides that, not a filter here.
     */
    expenseImageEvents(expenseId: string): Promise<ExpenseImageEvent[]> {
      return read<ExpenseImageEvent>(
        supabase
          .from('expense_image_events')
          .select('id, expense_id, actor_member_id, kind, action, visibility, created_at')
          .eq('expense_id', expenseId)
          .order('created_at', { ascending: true }),
      );
    },

    // ────────────────────────────────────────── the bill behind an expense ──

    /** The kept bill for one expense, or null. Group-readable under RLS. */
    async receipt(receiptId: string): Promise<Receipt | null> {
      const rows = await read<Receipt>(
        supabase
          .from('receipts')
          .select('id, group_id, storage_path, created_at')
          .eq('id', receiptId)
          .limit(1),
      );
      return rows[0] ?? null;
    },

    /**
     * Images attached to one expense, oldest first.
     *
     * The party-only ones simply do not come back for somebody who is not on
     * the bill — that is the RLS policy's job, not a filter here. Deleted rows
     * are left out.
     */
    expenseAttachments(expenseId: string): Promise<ExpenseAttachment[]> {
      return read<ExpenseAttachment>(
        supabase
          .from('expense_attachments')
          .select(
            'id, expense_id, group_id, uploader_member_id, storage_path, visibility, created_at',
          )
          .eq('expense_id', expenseId)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
      );
    },

    // ───────────────────────────────────────────── resolving an image (A44) ──
    // Images have two homes: Cloudflare R2 for everything uploaded since the
    // cut-over, Supabase Storage for anything before it. A caller must not have
    // to care which, so both of these take a path and hand back a URL — or null,
    // because a missing image is a blank space and never a thrown screen.
    //
    // This is the read half of the seam the phone has in `lib/storage`. The
    // write half stays there: the browser uploads nothing yet.

    /**
     * A short-lived URL for a group-readable object — a receipt, a group photo,
     * an avatar.
     */
    async imageUrl(bucket: string, path: string | null): Promise<string | null> {
      if (!path) return null;

      if (!r2Enabled) {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (error) return null;
        return data?.signedUrl ?? null;
      }

      try {
        const { data, error } = await supabase.functions.invoke('r2-sign', {
          body: { action: 'get', bucket, path },
        });
        if (error) return null;
        return (data as { url?: string } | null)?.url ?? null;
      } catch {
        return null;
      }
    },

    /**
     * A short-lived URL for a party-only object — an expense attachment, a
     * settlement proof.
     *
     * Addressed by *subject* (the expense or settlement), not by path: the edge
     * function re-checks that the caller is a party to it before signing, so a
     * leaked key is not a readable object. These live only on R2, so with R2 off
     * there is nothing to resolve and this answers null rather than reaching for
     * a bucket that would not gate the read.
     */
    async restrictedImageUrl(
      bucket: string,
      subjectId: string,
      path: string | null,
    ): Promise<string | null> {
      if (!path || !r2Enabled) return null;
      try {
        const { data, error } = await supabase.functions.invoke('r2-sign', {
          body: { action: 'get', bucket, subjectId, path },
        });
        if (error) return null;
        return (data as { url?: string } | null)?.url ?? null;
      } catch {
        return null;
      }
    },

    // ───────────────────────────────────────── comments on an expense (A46) ──
    // Reads go straight at the table, which grants SELECT to `authenticated`
    // behind an `is_group_member` policy; every write is a SECURITY DEFINER RPC
    // that decides for itself who may do what (any member may add and flag, an
    // author may edit or delete their own, an admin may delete any). The phone
    // reads these from its offline mirror instead — the web has none, so it
    // asks the server, and both end up at the same rows under the same policy.

    /** The comments on one expense, oldest first. Deleted ones are not returned. */
    expenseComments(expenseId: string): Promise<ExpenseComment[]> {
      return read<ExpenseComment>(
        supabase
          .from('expense_comments')
          .select(
            'id, group_id, expense_id, author_member_id, body, edited_at, flagged_at, flagged_by, created_at',
          )
          .eq('expense_id', expenseId)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
      );
    },

    /**
     * Add a comment. Any member may.
     *
     * The id is the caller's to choose and is the idempotency key: a retried
     * request with the same id returns the existing row rather than posting the
     * comment twice. The server refuses an id that belongs to somebody else's
     * comment rather than echoing it back, so a guessed id leaks nothing.
     *
     * The body is normalised before it is sent — the same sanitiser the phone
     * runs, so a comment written in a browser and one written on a phone are
     * stored in the same shape. An empty result is refused here rather than at
     * the server, so a composer holding only whitespace costs no round trip.
     */
    async addExpenseComment(input: {
      groupId: string;
      expenseId: string;
      commentId: string;
      body: string;
    }): Promise<string | null> {
      const body = sanitizeCommentMarkdown(input.body);
      if (body === '') return null;
      return rpc<string>('waves_add_expense_comment', {
        p_group_id: input.groupId,
        p_expense_id: input.expenseId,
        p_comment_id: input.commentId,
        p_body: body,
      });
    },

    /** Edit your own comment. The server stamps `edited_at`. */
    async editExpenseComment(commentId: string, body: string): Promise<boolean> {
      const clean = sanitizeCommentMarkdown(body);
      if (clean === '') return false;
      await rpc('waves_edit_expense_comment', { p_comment_id: commentId, p_body: clean });
      return true;
    },

    /** Delete your own comment; an admin may delete any. A soft delete. */
    deleteExpenseComment(commentId: string): Promise<void> {
      return rpc('waves_delete_expense_comment', { p_comment_id: commentId }).then(() => undefined);
    },

    /** Flag a comment, or take the flag back. Any member may. */
    flagExpenseComment(commentId: string, flag: boolean): Promise<void> {
      return rpc('waves_flag_expense_comment', {
        p_comment_id: commentId,
        p_flag: flag,
      }).then(() => undefined);
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

    /**
     * One group's activity, newest first.
     *
     * The unscoped `recentActivity` above is the dashboard's feed and reads
     * across every group the viewer can see. A group screen wants only its own,
     * and asking for sixty rows across every group to show three of them is the
     * wrong shape of request once somebody is in twenty groups.
     */
    groupActivity(groupId: string, limit = 60): Promise<ActivityRow[]> {
      return read<ActivityRow>(
        supabase
          .from('activity_log')
          .select(ACTIVITY_COLUMNS)
          .eq('group_id', groupId)
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

    /**
     * "No, that never reached me." Only the payee may dispute, and only while
     * the settlement is still initiated or auto-confirmed (server-checked).
     *
     * The other half of confirming. Without it a claim that somebody paid you
     * is a one-way street: you either accept it or it sits there, and the
     * balance it moved stays moved.
     */
    disputeSettlement(settlementId: string, reason?: string): Promise<void> {
      return rpc('waves_dispute_settlement', {
        p_settlement_id: settlementId,
        p_reason: reason ?? null,
      }).then(() => undefined);
    },

    /**
     * "I did not actually send that." Only the person who recorded the payment
     * may cancel it (server-checked).
     *
     * A settlement is a claim, and the person who made it is the one who can
     * withdraw it — a mistyped amount or the wrong payee should not need the
     * other side to reject it before it can be fixed.
     */
    cancelSettlement(settlementId: string): Promise<void> {
      return rpc('waves_cancel_settlement', { p_settlement_id: settlementId }).then(
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
    /**
     * This person's own category catalog, live rows only.
     *
     * No owner filter: the RLS policy is the filter, and one written here would
     * only be a second opinion about whose rows these are.
     */
    categoryTags(): Promise<CategoryTagRecord[]> {
      return read<CategoryTagRecord>(
        supabase
          .from('category_tags')
          .select('id, owner_user_id, builtin_id, label, icon, tint, sort_order, hidden')
          .is('deleted_at', null)
          .order('sort_order', { ascending: true }),
      );
    },

    /**
     * Create or change one catalog row.
     *
     * One call covers all three things the manager does, because they are the
     * same write: a new custom tag, an edit to one, and a built-in that somebody
     * hid or moved — which lazily gains an override row carrying nothing but its
     * place and its hidden flag.
     *
     * The id is minted by the caller so a retry replays as the same row.
     */
    async upsertCategoryTag(input: {
      id: string;
      builtinId?: string | null;
      label?: string | null;
      icon?: string | null;
      tint?: string | null;
      sortOrder: number;
      hidden?: boolean;
    }): Promise<void> {
      const { data: auth } = await supabase.auth.getUser();
      const owner = auth.user?.id;
      if (!owner) throw new WavesApiError('Not signed in');
      const { error } = await supabase.from('category_tags').upsert(
        {
          id: input.id,
          owner_user_id: owner,
          builtin_id: input.builtinId ?? null,
          label: input.label ?? null,
          icon: input.icon ?? null,
          tint: input.tint ?? null,
          sort_order: input.sortOrder,
          hidden: input.hidden ?? false,
          // A row being written again is a row that is not deleted.
          deleted_at: null,
        },
        { onConflict: 'id' },
      );
      if (error) throw new WavesApiError(String((error as { message?: string }).message ?? error));
    },

    /**
     * Retire a custom tag.
     *
     * A soft delete, and it has to be: every expense ever filed under this tag
     * carries its own snapshot of the label and colour, and those keep working.
     * What goes away is the tag's place in the picker, not the history.
     */
    async deleteCategoryTag(tagId: string): Promise<void> {
      const { error } = await supabase
        .from('category_tags')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', tagId);
      if (error) throw new WavesApiError(String((error as { message?: string }).message ?? error));
    },

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

    /**
     * How findable this person is, and how much of them shows.
     *
     * Read through the strict reader: the column carries a check constraint,
     * but a value that somehow escaped it must not be read as the more open
     * setting.
     */
    async discovery(): Promise<DiscoverySettings> {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id;
      if (!id) throw new WavesApiError('Not signed in');
      const rows = await read<{
        discoverable_by_phone: boolean | null;
        discoverable_by_email: boolean | null;
        contact_visibility: string | null;
      }>(
        supabase
          .from('profiles')
          .select('discoverable_by_phone, discoverable_by_email, contact_visibility')
          .eq('id', id)
          .limit(1),
      );
      const row = rows[0];
      return {
        discoverableByPhone: row?.discoverable_by_phone ?? DEFAULT_DISCOVERY.discoverableByPhone,
        discoverableByEmail: row?.discoverable_by_email ?? DEFAULT_DISCOVERY.discoverableByEmail,
        contactVisibility: readContactVisibility(row?.contact_visibility),
      };
    },

    async saveDiscovery(next: DiscoverySettings): Promise<void> {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id;
      if (!id) throw new WavesApiError('Not signed in');
      // The trailing `.select('id')` is not decoration: an update that matches
      // no row is not an error, and this account may genuinely have no profile
      // row — the
      // squashed baseline once dropped the new-user trigger and left exactly
      // that. Without asking for the row back, a write that changed nothing
      // reports success, and the screen says a privacy setting was saved that
      // was not. That is the same failing-open this file refuses elsewhere.
      const { data, error } = await supabase
        .from('profiles')
        .update({
          discoverable_by_phone: next.discoverableByPhone,
          discoverable_by_email: next.discoverableByEmail,
          contact_visibility: next.contactVisibility,
        })
        .eq('id', id)
        .select('id');
      if (error) throw new WavesApiError(String((error as { message?: string }).message ?? error));
      if (!data || data.length === 0) {
        throw new WavesApiError('Your profile could not be found, so nothing was saved.');
      }
    },

    /**
     * Every device on this account seen in the last three months, newest first.
     *
     * A browser is not one of them: only the phone app registers, so this list
     * is the phones. Reading it from a laptop is the useful direction — it is
     * where somebody goes when the phone is the thing they have lost.
     */
    async devices(): Promise<DeviceSession[]> {
      return (await rpc<DeviceSession[] | null>('waves_list_devices', {})) ?? [];
    },

    /**
     * Revoke every device except the one named, and tear down the sessions.
     *
     * Two halves, and both are needed. The RPC marks the rows revoked, which is
     * what the devices list reads; `signOut({ scope: 'others' })` ends the
     * actual sessions. Doing only the first leaves a signed-in phone that the
     * list calls revoked; doing only the second leaves a list that still shows
     * it as live.
     *
     * The browser has no device id of its own, so it passes a sentinel that
     * matches nothing and revokes all of them. That is not a loophole — the RPC
     * is scoped to the caller's own profile and can reach nobody else's rows.
     */
    async signOutOtherDevices(exceptDeviceId: string): Promise<number> {
      const revoked =
        (await rpc<number | null>('waves_sign_out_other_devices', {
          p_device_id: exceptDeviceId,
        })) ?? 0;
      const { error } = await supabase.auth.signOut({ scope: 'others' });
      if (error) throw new WavesApiError(error.message);
      return revoked;
    },

    /** What erasure would leave behind, so a screen can say so before the button. */
    async erasurePreview(): Promise<ErasurePreview | null> {
      const rows = await rpc<ErasurePreview[] | null>('waves_my_erasure_preview', {});
      return rows?.[0] ?? null;
    },

    /**
     * Erase the person, keep the ledger.
     *
     * Through the `account-delete` edge function rather than the RPC directly,
     * because the two halves need two different keys. The function runs
     * `waves_delete_my_account` as the caller — every membership becomes an
     * unnamed ghost and the profile and everything personal hanging off it is
     * deleted — and then removes the auth identity with the service key, which
     * no client holds. The RPC alone would leave an account that could still
     * sign in to nothing.
     *
     * The caller signs out afterwards, and only once the data is gone.
     */
    deleteMyAccount(reason: string | null): Promise<{ memberships_anonymised?: number }> {
      return callFunction<{ memberships_anonymised?: number }>('account-delete', { reason });
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
