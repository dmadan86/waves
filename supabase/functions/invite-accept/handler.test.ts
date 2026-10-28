/**
 * invite-accept: joining a shared group needs an account (ADR-006 amendment,
 * 2026-10-11). The handler is driven over injected boundaries, so no Deno or
 * network is needed. What is pinned:
 *
 *   - preview stays open to anyone holding the link (no auth header needed);
 *   - an anonymous caller is refused with 403 ACCOUNT_REQUIRED on a direct join
 *     AND on a ghost claim, and nothing is written or spent;
 *   - a real account joins, via the single atomic RPC;
 *   - the database's own refusal (a modified path that skipped the early check)
 *     comes back as the same 403, not a 500;
 *   - an anonymous caller already in the group still gets in (nobody is removed).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_REQUIRED,
  handleInviteAccept,
  REMOVED_FROM_GROUP,
  type InviteAcceptDeps,
} from './handler.ts';

const INVITE = {
  id: 'inv-1',
  group_id: 'g-1',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  revoked_at: null,
  max_uses: 10,
  use_count: 0,
};

interface Options {
  company?: boolean;
  anonymous?: boolean | null;
  noUser?: boolean;
  members?: { id: string; ghost_name: string | null; profile_id: string | null }[];
  joinResult?: { data: unknown; error: { message: string } | null };
  claimResult?: { data: unknown; error: { message: string } | null };
}

function harness(options: Options = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'waves_join_via_invite') {
      return options.joinResult ?? { data: { ok: true, member_id: 'm-new' }, error: null };
    }
    if (name === 'waves_request_member_claim') {
      return options.claimResult ?? { data: { ok: true, claim_id: 'c-1' }, error: null };
    }
    return { data: null, error: null };
  });
  const inserts: { table: string; row: unknown }[] = [];
  const table = (name: string) => {
    const state = { name };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: self,
      eq: self,
      is: self,
      maybeSingle: async () => ({
        data:
          state.name === 'invites'
            ? INVITE
            : { id: 'g-1', name: 'Goa', cover_emoji: null, default_currency: 'INR', type: options.company ? 'company' : 'trip' },
        error: null,
      }),
      insert: async (row: unknown) => {
        inserts.push({ table: state.name, row });
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: options.members ?? [], error: null }),
    });
    return chain;
  };
  const service = { from: vi.fn(table), rpc } as never;
  const caller = {
    auth: {
      getUser: async () =>
        options.noUser
          ? { data: { user: null }, error: { message: 'no' } }
          : {
              data: {
                user: {
                  id: 'u-1',
                  is_anonymous: options.anonymous ?? false,
                  created_at: new Date().toISOString(),
                },
              },
              error: null,
            },
    },
  } as never;
  const deps: InviteAcceptDeps = {
    asCaller: () => caller,
    asService: () => service,
    enforceRateLimit: async () => undefined,
  };
  return { deps, rpc, inserts };
}

const post = (body: unknown) =>
  new Request('https://fn.example/invite-accept', {
    method: 'POST',
    headers: { Authorization: 'Bearer jwt' },
    body: JSON.stringify(body),
  });

describe('invite-accept requires an account to join', () => {
  it('previews for anybody holding the link, without an auth header', async () => {
    const { deps } = harness({ noUser: true });
    const response = await handleInviteAccept(
      new Request('https://fn.example/invite-accept', {
        method: 'POST',
        body: JSON.stringify({ token: 't', mode: 'preview' }),
      }),
      deps,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).group.name).toBe('Goa');
  });

  it('refuses an anonymous direct join with 403 ACCOUNT_REQUIRED and spends nothing', async () => {
    const { deps, rpc, inserts } = harness({ anonymous: true });
    const response = await handleInviteAccept(post({ token: 't', mode: 'join' }), deps);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(ACCOUNT_REQUIRED);
    expect(rpc).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it('refuses an anonymous ghost claim the same way', async () => {
    const { deps, rpc } = harness({
      anonymous: true,
      members: [{ id: 'ghost-1', ghost_name: 'Ravi', profile_id: null }],
    });
    const response = await handleInviteAccept(
      post({ token: 't', mode: 'join', claimMemberId: 'ghost-1' }),
      deps,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(ACCOUNT_REQUIRED);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('lets a real account join through the atomic RPC', async () => {
    const { deps, rpc } = harness({ anonymous: false });
    const response = await handleInviteAccept(post({ token: 't', mode: 'join' }), deps);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.memberId).toBe('m-new');
    expect(rpc).toHaveBeenCalledWith('waves_join_via_invite', {
      p_invite_id: 'inv-1',
      p_profile_id: 'u-1',
    });
  });

  it('maps the database refusal to the same 403 (a path that skipped the early check)', async () => {
    const { deps } = harness({
      anonymous: false, // the token claimed a real account; the database knows better
      joinResult: { data: { ok: false, reason: 'ACCOUNT_REQUIRED' }, error: null },
    });
    const response = await handleInviteAccept(post({ token: 't', mode: 'join' }), deps);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(ACCOUNT_REQUIRED);
  });

  it('maps a trigger exception to 403 rather than a 500', async () => {
    const { deps } = harness({
      joinResult: { data: null, error: { message: 'ACCOUNT_REQUIRED: sign up' } },
    });
    const response = await handleInviteAccept(post({ token: 't', mode: 'join' }), deps);
    expect(response.status).toBe(403);
  });

  it('maps REMOVED on a direct join to 403 REMOVED_FROM_GROUP with the ask-an-admin message', async () => {
    const { deps, inserts } = harness({
      joinResult: { data: { ok: false, reason: 'REMOVED' }, error: null },
    });
    const response = await handleInviteAccept(post({ token: 't', mode: 'join' }), deps);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe(REMOVED_FROM_GROUP);
    expect(body.message).toBe('You were removed from this group. Ask an admin for a new invite.');
    expect(inserts).toEqual([]);
  });

  it('maps REMOVED on a ghost claim the same way', async () => {
    const { deps, inserts } = harness({
      members: [{ id: 'ghost-1', ghost_name: 'Ravi', profile_id: null }],
      claimResult: { data: { ok: false, reason: 'REMOVED' }, error: null },
    });
    const response = await handleInviteAccept(
      post({ token: 't', mode: 'join', claimMemberId: 'ghost-1' }),
      deps,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(REMOVED_FROM_GROUP);
    expect(inserts).toEqual([]);
  });

  it('still lets an anonymous caller who is already a member in (nobody is removed)', async () => {
    const { deps, rpc } = harness({
      anonymous: true,
      members: [{ id: 'm-old', ghost_name: null, profile_id: 'u-1' }],
    });
    const response = await handleInviteAccept(post({ token: 't', mode: 'join' }), deps);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.alreadyMember).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('answers 401 when there is no user at all', async () => {
    const { deps } = harness({ noUser: true });
    const response = await handleInviteAccept(post({ token: 't', mode: 'join' }), deps);
    expect(response.status).toBe(401);
  });
});


it('company preview reveals neither roster count nor claimable placeholders', async () => {
  const { deps, rpc } = harness({ company: true, noUser: true,
    members: [{ id: 'private-ghost', ghost_name: 'Private colleague', profile_id: null }] });
  const response = await handleInviteAccept(post({ token: 't', mode: 'preview' }), deps);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.group.type).toBe('company');
  expect(body).not.toHaveProperty('memberCount');
  expect(body).not.toHaveProperty('claimable');
  expect(JSON.stringify(body)).not.toContain('Private colleague');
  expect(rpc).not.toHaveBeenCalled();
});
