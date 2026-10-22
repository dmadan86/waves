/**
 * `member.add_ghost` and the account it may name.
 *
 * A member cloned from another group who is on Waves travels with their
 * `profileId`, and the RPC gets it as `p_profile_id` so they join as
 * themselves. Every other add — a typed name, a contact — must not send the
 * argument at all: it only exists from 20261023110000_add_member_by_profile
 * on, and an argument the database does not know fails the whole call.
 *
 * The session is driven with a stubbed Supabase client: no Deno, no network, no
 * database.
 */

import { describe, expect, it, vi } from 'vitest';

import { SyncSession } from './index.ts';

const OWNER = 'owner-profile-id';
const GROUP_ID = '99999999-8888-7777-6666-555555555555';

function caller() {
  const rpc = vi.fn(() => Promise.resolve({ data: 'member-id', error: null }));
  return { client: { rpc } as never, rpc };
}

function service() {
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = { insert: () => Promise.resolve({ error: null }) };
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { from } as never;
}

function addGhost(payload: Record<string, unknown>) {
  return {
    clientMutationId: 'add-1',
    kind: 'member.add_ghost',
    groupId: GROUP_ID,
    seq: 1,
    clientCreatedAt: '2026-10-23T01:57:00.000Z',
    payload,
  } as never;
}

describe('member.add_ghost', () => {
  it('names the account when the client did', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service(), OWNER);

    await session.apply(addGhost({ name: 'Matt', profileId: 'p-matt' }));

    expect(scoped.rpc).toHaveBeenCalledWith(
      'waves_add_ghost_member',
      expect.objectContaining({ p_group_id: GROUP_ID, p_name: 'Matt', p_profile_id: 'p-matt' }),
    );
  });

  it('sends no account argument for a plain placeholder', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service(), OWNER);

    await session.apply(addGhost({ name: 'Renny', email: 'renny@example.com', profileId: null }));

    const [, args] = scoped.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args).toEqual({
      p_group_id: GROUP_ID,
      p_name: 'Renny',
      p_member_id: null,
      p_email: 'renny@example.com',
      p_phone: null,
    });
  });
});
