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
const MEMBER_ID = '11111111-2222-3333-4444-555555555555';

/**
 * The caller-scoped client: `rpc` records the arguments and answers with an id,
 * `update` records the patch a `group.update` would write. `maybeSingle`
 * answers the membership lookup `group.update` makes before it writes.
 */
function caller() {
  const rpc = vi.fn(() => Promise.resolve({ data: GROUP_ID, error: null }));
  const update = vi.fn(() => Promise.resolve({ error: null }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: { id: MEMBER_ID }, error: null });
    builder.update = (patch: Record<string, unknown>) => {
      void update(patch);
      return { eq: () => Promise.resolve({ error: null }) };
    };
    return builder;
  });
  return { client: { rpc, from } as never, rpc, update };
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

  // The body is cast to `SyncRequest`, never parsed, so a payload can carry
  // anything. Absent and wrong are not the same thing: folding a number into
  // null would make a malformed create quietly produce an unnamed group.
  it('refuses a name that is not text rather than treating it as absent', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(createGroup(42, 'mutation-4'));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.rpc).not.toHaveBeenCalled();
  });

  it('refuses an object name too', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(createGroup({ evil: true }, 'mutation-5'));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.rpc).not.toHaveBeenCalled();
  });
});

function updateGroup(payload: Record<string, unknown>, clientMutationId = 'update-1') {
  return {
    clientMutationId,
    kind: 'group.update',
    groupId: GROUP_ID,
    seq: 1,
    clientCreatedAt: '2026-09-06T02:20:00.000Z',
    payload,
  } as never;
}

/**
 * The same reading of a name on the way back out.
 *
 * Clearing a group's name is ordinary — it goes back to being labelled by who
 * is in it — and it has to land as NULL. An empty string in `groups.name` is a
 * name that renders as nothing everywhere instead of falling back to the
 * members, which is exactly the state `group.create` refuses to create. The
 * app's own rename screen trims before it queues, but `/sync` is a boundary: a
 * column normalised on one path and trusted on the other is how the two ends
 * drift apart.
 */
describe('group.update and the name column', () => {
  it('clears the name to null when it is emptied', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    await session.apply(updateGroup({ name: '' }));

    expect(scoped.update).toHaveBeenCalledWith({ name: null });
  });

  it('treats a whitespace-only name as cleared, not as a name of spaces', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    await session.apply(updateGroup({ name: '   ' }, 'update-2'));

    expect(scoped.update).toHaveBeenCalledWith({ name: null });
  });

  it('passes an explicit null through unchanged', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    await session.apply(updateGroup({ name: null }, 'update-3'));

    expect(scoped.update).toHaveBeenCalledWith({ name: null });
  });

  it('trims a real rename', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    await session.apply(updateGroup({ name: '  Goa trip  ' }, 'update-4'));

    expect(scoped.update).toHaveBeenCalledWith({ name: 'Goa trip' });
  });

  // The destructive half of the same hole: a malformed rename must not clear a
  // name somebody chose.
  it('refuses a rename that is not text instead of clearing the name', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(updateGroup({ name: 42 }, 'update-6'));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.update).not.toHaveBeenCalled();
  });

  it('leaves a patch that never mentioned the name alone', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    await session.apply(updateGroup({ cover_emoji: 'X' }, 'update-5'));

    // No `name` key invented, so a rename is not written as a side effect of
    // changing the icon.
    expect(scoped.update).toHaveBeenCalledWith({ cover_emoji: 'X' });
  });
});
