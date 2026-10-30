/**
 * invite-accept — the other half of the growth loop (ADR-006).
 *
 * Two modes, both authorized purely by possession of a valid token:
 *  - `preview` (GET-ish): what group is this, who is already in it, and which
 *    ghosts could be me? Callable by anyone holding the link, so the join
 *    screen can show something real before asking for an account.
 *  - `join`: add the caller as a member. The caller must have an account:
 *    an anonymous guest is refused with ACCOUNT_REQUIRED (ADR-006 amendment,
 *    2026-10-11). If they name a ghost, that ghost is
 *    claimed instead — its whole history becomes theirs, atomically, and the
 *    ghost row stops existing as a separate participant.
 *
 * Claiming runs service-role-only, which is the entire reason this is an edge
 * function rather than an RLS-guarded insert (ADR-013).
 */

import { errorResponse, HttpError, json, type SupabaseClient } from '../_shared/auth.ts';

/** The side-effecting boundaries `index.ts` injects and tests mock. */
export interface InviteAcceptDeps {
  asCaller(request: Request): SupabaseClient;
  asService(): SupabaseClient;
  enforceRateLimit(
    service: SupabaseClient,
    request: Request,
    bucket: 'invite-accept',
  ): Promise<void>;
}

/**
 * The refusal an anonymous (guest) caller gets for a join. Stable: the apps
 * key their "sign up to join" prompt off it, and old builds show their generic
 * "could not join" message for it.
 */
export const ACCOUNT_REQUIRED = 'ACCOUNT_REQUIRED';
const ACCOUNT_REQUIRED_MESSAGE = 'Create a free account (or log in) to join this group';

/**
 * The refusal for somebody an admin removed who presents an invite from before
 * the removal. Only an invite minted afterwards brings them back. Stable: the
 * apps key their message off it.
 */
export const REMOVED_FROM_GROUP = 'REMOVED_FROM_GROUP';
const REMOVED_FROM_GROUP_MESSAGE =
  'You were removed from this group. Ask an admin for a new invite.';

interface AcceptRequest {
  token: string;
  mode?: 'preview' | 'join';
  /** Optional ghost to claim instead of joining as a new person. */
  claimMemberId?: string | null;
  displayName?: string | null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function handleInviteAccept(
  request: Request,
  deps: InviteAcceptDeps,
): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');

    const body = (await request.json()) as AcceptRequest;
    if (!body.token) throw new HttpError(400, 'NO_TOKEN', 'This link is missing its token');

    const service = deps.asService();

    // Before the lookup, not after. Everything below this line is the oracle:
    // one token in, "yes that is a real group" or "no" out. Counting after the
    // answer has been computed would rate-limit nothing that matters.
    //
    // Keyed on the client address because there is no profile yet — preview
    // deliberately answers before anybody signs in (ADR-006), which is exactly
    // what makes it worth guarding.
    await deps.enforceRateLimit(service, request, 'invite-accept');

    const { data: invite, error } = await service
      .from('invites')
      .select('id, group_id, expires_at, revoked_at, max_uses, use_count, company_vendor_id')
      .eq('token_hash', await sha256Hex(body.token))
      .maybeSingle();
    if (error) throw new HttpError(500, 'INTERNAL', error.message);

    // One message for every failure mode: a probing caller learns nothing about
    // which links exist.
    if (
      !invite ||
      invite.revoked_at ||
      new Date(invite.expires_at) < new Date() ||
      invite.use_count >= invite.max_uses
    ) {
      throw new HttpError(404, 'INVITE_INVALID', 'This invite link is no longer valid');
    }

    // `service` is the service role, so RLS is not doing any filtering here and
    // the tombstone has to be asked about by name. A group somebody deleted
    // (A49) keeps its rows — that is how the delete travels to other devices —
    // so without this a QR code or a WhatsApp link for a group that no longer
    // exists still previewed with its name and member count, and still let
    // people in.
    const { data: group } = await service
      .from('groups')
      .select('id, name, cover_emoji, default_currency, type')
      .eq('id', invite.group_id)
      .is('deleted_at', null)
      .maybeSingle();

    // The same answer as a revoked or expired link, deliberately: a caller
    // learns that the link does not work, not which groups have been deleted.
    if (!group) {
      throw new HttpError(404, 'INVITE_INVALID', 'This invite link is no longer valid');
    }

    if (body.mode !== 'join' && group.type === 'company') {
      return json({ group });
    }

    const { data: members } = await service
      .from('group_members')
      // FK-hinted: ghost_merges bridges group_members and profiles, so the embed
      // is ambiguous without naming the column.
      .select('id, ghost_name, profile_id, role, profiles!profile_id ( display_name )')
      .eq('group_id', invite.group_id)
      .is('left_at', null);

    const claimable = (members ?? [])
      .filter((member) => member.profile_id === null)
      .map((member) => ({ memberId: member.id, name: member.ghost_name }));

    if (body.mode !== 'join') {
      return json({
        group,
        memberCount: members?.length ?? 0,
        claimable,
      });
    }

    // Joining needs an account: anonymous does not count (ADR-006 amendment,
    // 2026-10-11). Preview above stays open to anyone holding the link.
    const caller = deps.asCaller(request);
    const { data: user, error: userError } = await caller.auth.getUser();
    if (userError || !user?.user) {
      throw new HttpError(401, 'NOT_AUTHENTICATED', 'Sign in first');
    }
    const profileId = user.user.id;

    const existing = (members ?? []).find((member) => member.profile_id === profileId);
    if (existing) {
      return json({
        group,
        memberId: existing.id,
        alreadyMember: true,
        ...(existing.role === 'vendor' ? { vendor: true } : {}),
      });
    }

    // A guest may not join a shared group. Checked after the already-a-member
    // short-circuit, so a guest who joined before this rule keeps opening their
    // group. The database refuses the same caller independently (see
    // waves_join_via_invite and the group_members trigger), so this is the
    // friendly early answer, not the only one.
    if (user.user.is_anonymous === true) {
      throw new HttpError(403, ACCOUNT_REQUIRED, ACCOUNT_REQUIRED_MESSAGE);
    }

    let memberId: string;

    if (body.claimMemberId) {
      const ghost = (members ?? []).find(
        (member) => member.id === body.claimMemberId && member.profile_id === null,
      );
      if (!ghost) {
        throw new HttpError(400, 'NOT_CLAIMABLE', 'That person has already been claimed');
      }

      // Asking, not taking. This used to hand the ghost over on the spot, which
      // meant anybody holding the link could become "Ravi" and inherit every
      // share and settlement filed under that name. ADR-006 always said the
      // organizer confirms; now something does.
      //
      // Nobody joins here. The claim is decided by an admin through
      // `waves_decide_member_claim`, and that function — not this one — is
      // where "who may approve this" lives, next to the table it guards.
      //
      // The invite use is NOT reserved here. This function used to call
      // `waves_consume_invite` before this branch, which burned a `max_uses`
      // slot the instant a claim was tapped — every tap, whether or not an admin
      // ever agreed, so one link could be emptied by repeated ghost-claims with
      // nobody joining. The reservation now lives inside `waves_request_member_claim`
      // (with the invite id passed below): it spends exactly one use for a
      // genuinely-new claim, and nothing for a repeat (already-pending) or a
      // doomed one — atomically, in the same transaction as the claim row.
      const { data: verdict, error: claimError } = await service.rpc('waves_request_member_claim', {
        p_group_id: invite.group_id,
        p_member_id: ghost.id,
        p_profile_id: profileId,
        p_name: body.displayName ?? null,
        p_invite_id: invite.id,
      });
      if (claimError) throw new HttpError(500, 'CLAIM_FAILED', claimError.message);
      if (verdict?.reason === ACCOUNT_REQUIRED) {
        throw new HttpError(403, ACCOUNT_REQUIRED, ACCOUNT_REQUIRED_MESSAGE);
      }
      if (verdict?.reason === 'REMOVED') {
        throw new HttpError(403, REMOVED_FROM_GROUP, REMOVED_FROM_GROUP_MESSAGE);
      }
      if (verdict?.reason === 'INVITE_INVALID') {
        throw new HttpError(404, 'INVITE_INVALID', 'This invite link is no longer valid');
      }
      if (!verdict?.ok) {
        throw new HttpError(
          409,
          verdict?.reason ?? 'NOT_CLAIMABLE',
          'That place is no longer free to claim',
        );
      }

      // The name is not written yet: it belongs to somebody who has only said
      // they are that person. It is carried on the claim and applied if and
      // when an admin agrees.
      return json({
        group,
        pending: true,
        claimId: verdict.claim_id,
        alreadyPending: verdict.already_pending === true,
      });
    } else {
      // A direct join, and the one place a use is spent up front. One database
      // function does the whole thing atomically: refuse a guest (before any
      // use is spent), reserve a use (a conditional increment, so two
      // redemptions cannot both take the last slot), and add the membership.
      const { data: joined, error: joinError } = await service.rpc('waves_join_via_invite', {
        p_invite_id: invite.id,
        p_profile_id: profileId,
      });
      if (joinError) {
        // The membership trigger is the backstop behind the function above.
        if (/ACCOUNT_REQUIRED/.test(joinError.message)) {
          throw new HttpError(403, ACCOUNT_REQUIRED, ACCOUNT_REQUIRED_MESSAGE);
        }
        throw new HttpError(500, 'INTERNAL', joinError.message);
      }
      if (joined?.reason === ACCOUNT_REQUIRED) {
        throw new HttpError(403, ACCOUNT_REQUIRED, ACCOUNT_REQUIRED_MESSAGE);
      }
      if (joined?.reason === 'REMOVED') {
        throw new HttpError(403, REMOVED_FROM_GROUP, REMOVED_FROM_GROUP_MESSAGE);
      }
      if (!joined?.ok) {
        throw new HttpError(404, 'INVITE_INVALID', 'This invite link is no longer valid');
      }
      memberId = joined.member_id as string;
    }

    await service.from('activity_log').insert({
      group_id: invite.group_id,
      actor_member_id: memberId,
      verb: body.claimMemberId ? 'claimed' : 'joined',
      object_type: 'member',
      object_id: memberId,
      payload: { via: 'invite_link' },
    });

    // A vendor invite makes the person that vendor's login: the app lands them on their ledger, not on Add entry.
    return json({
      group,
      memberId,
      claimed: Boolean(body.claimMemberId),
      ...(invite.company_vendor_id ? { vendor: true } : {}),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'invite-accept' });
  }
}
