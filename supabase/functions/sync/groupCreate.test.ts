/**
 * A group does not need a name.
 *
 * `new-group.tsx` says so in as many words — "Blank is fine — the group gets
 * labelled by who is in it instead" — and it sends `name: null` when nobody
 * typed one. `waves_create_group` accepts that. This function did not: it ran
 * the name through `requireString`, so a nameless group was rejected with
 * `VALIDATION_FAILED: name is required` before it ever reached the database.
 *
 * The cost was worse than a failed save, because `group.create` has no
 * optimistic mirror row — the group only exists on the phone once the server's
 * change comes back. So the create was queued, refused, and never materialised:
 * the phone opened "Group not found" for the group it had just made, the
 * dashboard said "No groups yet", and the only clue was a red glyph in the
 * header.
 *
 * The session is driven with a stubbed Supabase client: no Deno, no network, no
 * database. What is asserted is the contract the client relies on — a name is
 * optional, blank means null rather than an empty string, and a real name still
 * arrives trimmed.
 */

import { describe, expect, it, vi } from 'vitest';

import { SyncSession } from './index.ts';

const OWNER = 'owner-profile-id';
const GROUP_ID = '99999999-8888-7777-6666-555555555555';

/** The caller-scoped client: `rpc` records the arguments and answers with an id. */
function caller() {
  const rpc = vi.fn(() => Promise.resolve({ data: GROUP_ID, error: null }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { client: { rpc, from } as never, rpc };
}

/** The service-role client: the replay guard's own table, and nothing else. */
function service() {
  const insert = vi.fn(() => Promise.resolve({ error: null }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = { insert };
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { client: { from } as never, insert };
}

function createGroup(name: unknown, clientMutationId = 'mutation-1') {
  return {
    clientMutationId,
    kind: 'group.create',
    groupId: GROUP_ID,
    seq: 1,
    clientCreatedAt: '2026-09-06T01:57:00.000Z',
    payload: {
      name,
      type: 'trip',
      currency: 'INR',
      simplify: true,
      creatorMemberId: '11111111-2222-3333-4444-555555555555',
    },
  } as never;
}

describe('group.create without a name', () => {
  it('applies a null name instead of refusing it', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(createGroup(null));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith(
      'waves_create_group',
      expect.objectContaining({ p_name: null, p_group_id: GROUP_ID }),
    );
  });

  it('treats a blank name as no name, not as an empty one', async () => {
    // '' in `groups.name` is a name that renders as nothing everywhere, rather
    // than falling back to the members — so it has to collapse to NULL.
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    await session.apply(createGroup('   ', 'mutation-2'));

    expect(scoped.rpc).toHaveBeenCalledWith(
      'waves_create_group',
      expect.objectContaining({ p_name: null }),
    );
  });

  it('still passes a real name through, trimmed', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    await session.apply(createGroup('  Goa trip  ', 'mutation-3'));

    expect(scoped.rpc).toHaveBeenCalledWith(
      'waves_create_group',
      expect.objectContaining({ p_name: 'Goa trip' }),
    );
  });
});
