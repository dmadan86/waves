/**
 * A group does not need a name, and clearing one is not a failure.
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
 * Three things are asserted here, on both the create and the update path
 * because one column normalised on the way in and trusted on the way past is
 * how the two ends drift apart: a name is optional, blank of any kind means
 * NULL rather than an empty string, and a real name arrives trimmed. Plus the
 * half that is not about blankness at all — a name that is not text is refused
 * rather than read as absent, since the request body is cast to `SyncRequest`
 * and never parsed, and folding a number into null would let a malformed
 * rename quietly delete a name somebody chose.
 *
 * The session is driven with a stubbed Supabase client: no Deno, no network, no
 * database.
 */

import { describe, expect, it, vi } from 'vitest';

import { SyncSession } from './index.ts';

const OWNER = 'owner-profile-id';
const GROUP_ID = '99999999-8888-7777-6666-555555555555';
const MEMBER_ID = '11111111-2222-3333-4444-555555555555';

/**
 * The caller-scoped client.
 *
 * Both calls the code under test makes go through `rpc`, and they are told
 * apart by name: `group.update` resolves the caller's membership through
 * `waves_my_member_id` before it writes (see `memberId`), and `group.create`
 * goes straight to `waves_create_group`. Answering every `rpc` with the same
 * value would let the membership check pass on a group id, which is true by
 * accident rather than by the code doing the right thing.
 *
 * `update` records the patch a `group.update` would write, and hands back the
 * `.eq(...)` the real builder chains.
 */
function caller() {
  const rpc = vi.fn((name: string) =>
    Promise.resolve({ data: name === 'waves_my_member_id' ? MEMBER_ID : GROUP_ID, error: null }),
  );
  const updateEq = vi.fn(() => Promise.resolve({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = { update };
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
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

function createGroup(name: unknown, clientMutationId = 'create-1') {
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
      creatorMemberId: MEMBER_ID,
    },
  } as never;
}

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
 * Every shape of "no name somebody typed". They have to land as NULL rather
 * than travel on as themselves: an empty string in `groups.name` is a name that
 * renders as nothing everywhere instead of falling back to the members.
 */
const BLANK_NAMES: readonly [string, unknown][] = [
  ['an explicit null', null],
  ['an empty string', ''],
  ['only spaces', '   '],
  ['only a newline and a tab', '\n\t'],
];

/** Values that are not text at all — a client bug, not an omission. */
const NON_TEXT_NAMES: readonly [string, unknown][] = [
  ['a number', 42],
  ['an object', { evil: true }],
  ['a boolean', true],
];

describe('group.create and the name column', () => {
  it.each(BLANK_NAMES)('creates the group when the name is %s', async (_label, name) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(createGroup(name));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith(
      'waves_create_group',
      expect.objectContaining({ p_name: null, p_group_id: GROUP_ID }),
    );
  });

  it('still passes a real name through, trimmed', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(createGroup('  Goa trip  ', 'create-real'));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith(
      'waves_create_group',
      expect.objectContaining({ p_name: 'Goa trip' }),
    );
  });

  // Absent and wrong are not the same thing. Folding these into null would make
  // a malformed create quietly produce an unnamed group.
  it.each(NON_TEXT_NAMES)(
    'refuses a name that is %s rather than reading it as absent',
    async (_label, name) => {
      const scoped = caller();
      const session = new SyncSession(scoped.client, service().client, OWNER);

      const outcome = await session.apply(createGroup(name, 'create-bad'));

      expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
      // Refused before the database was asked to do anything.
      expect(scoped.rpc).not.toHaveBeenCalled();
    },
  );
});

/**
 * The same reading of a name on the way back out.
 *
 * Clearing a group's name is ordinary — it goes back to being labelled by who
 * is in it — and it has to land as NULL, exactly the state `group.create`
 * already refuses to write any other way. The app's own rename screen trims
 * before it queues, but `/sync` is a boundary that an older build, the web
 * client or the watch also speak to.
 */
describe('group.update and the name column', () => {
  it.each(BLANK_NAMES)('clears the name when it is %s', async (_label, name) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(updateGroup({ name }));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.update).toHaveBeenCalledWith({ name: null });
  });

  it('trims a real rename', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(updateGroup({ name: '  Goa trip  ' }, 'update-real'));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.update).toHaveBeenCalledWith({ name: 'Goa trip' });
  });

  // The destructive half of the same hole: a malformed rename must not clear a
  // name somebody chose.
  it.each(NON_TEXT_NAMES)(
    'refuses a rename that is %s instead of clearing the name',
    async (_label, name) => {
      const scoped = caller();
      const session = new SyncSession(scoped.client, service().client, OWNER);

      const outcome = await session.apply(updateGroup({ name }, 'update-bad'));

      expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
      expect(scoped.update).not.toHaveBeenCalled();
    },
  );

  it('leaves a patch that never mentioned the name alone', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(updateGroup({ cover_emoji: 'X' }, 'update-icon'));

    // No `name` key invented, so a rename is not written as a side effect of
    // changing the icon.
    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.update).toHaveBeenCalledWith({ cover_emoji: 'X' });
  });
});
