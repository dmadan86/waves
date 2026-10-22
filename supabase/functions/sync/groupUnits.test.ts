/**
 * `group.update` with `units` — the families inside a group.
 *
 * Only an admin may arrange them, and the map has to name this group's own
 * members. The shape rules themselves live in `validateGroupUnits` (core, with
 * its own tests); what this covers is the boundary: the admin gate, the member
 * list the ids are checked against, and that the normalised map (not the raw
 * payload) is what reaches the column.
 *
 * Driven with a stubbed Supabase client: no Deno, no network, no database.
 */

import { describe, expect, it, vi } from 'vitest';

import { SyncSession } from './index.ts';

const OWNER = 'owner-profile-id';
const GROUP_ID = '99999999-8888-7777-6666-555555555555';
const ME = '11111111-2222-3333-4444-555555555555';
const RAVI = '22222222-2222-3333-4444-555555555555';
const PRIYA = '33333333-2222-3333-4444-555555555555';

function caller(myRole: 'admin' | 'member') {
  const rpc = vi.fn((name: string) =>
    Promise.resolve({ data: name === 'waves_my_member_id' ? ME : GROUP_ID, error: null }),
  );
  const updateEq = vi.fn(() => Promise.resolve({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const members = [
    { id: ME, role: myRole },
    { id: RAVI, role: 'member' },
    { id: PRIYA, role: 'member' },
  ];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = { update };
    builder.select = () => builder;
    builder.eq = () =>
      table === 'group_members' ? Promise.resolve({ data: members, error: null }) : builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { client: { rpc, from } as never, update };
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

function updateUnits(units: unknown) {
  return {
    clientMutationId: 'units-1',
    kind: 'group.update',
    groupId: GROUP_ID,
    seq: 1,
    clientCreatedAt: '2026-10-25T02:20:00.000Z',
    payload: { units },
  } as never;
}

describe('group.update units', () => {
  it('stores the normalised map when an admin sends a good one', async () => {
    const scoped = caller('admin');
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(
      updateUnits({ sharma: { name: '  Sharma family ', members: [RAVI, PRIYA], head: PRIYA } }),
    );

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.update).toHaveBeenCalledWith({
      units: { sharma: { name: 'Sharma family', members: [RAVI, PRIYA], head: PRIYA } },
    });
  });

  it('clears the families on null', async () => {
    const scoped = caller('admin');
    const session = new SyncSession(scoped.client, service(), OWNER);
    await session.apply(updateUnits(null));
    expect(scoped.update).toHaveBeenCalledWith({ units: null });
  });

  it('refuses a member who is not an admin', async () => {
    const scoped = caller('member');
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(updateUnits({ u: { name: 'Sharma', members: [RAVI] } }));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'NOT_AN_ADMIN' });
    expect(scoped.update).not.toHaveBeenCalled();
  });

  it.each([
    ['someone not in the group', { u: { name: 'Sharma', members: ['not-a-member'] } }],
    [
      'a person in two families',
      { u: { name: 'A', members: [RAVI] }, v: { name: 'B', members: [RAVI] } },
    ],
    ['a 25-character name', { u: { name: 'x'.repeat(25), members: [RAVI] } }],
    ['a head outside the family', { u: { name: 'A', members: [RAVI], head: PRIYA } }],
    ['a list instead of a map', [{ name: 'A', members: [RAVI] }]],
  ])('rejects %s', async (_label, units) => {
    const scoped = caller('admin');
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(updateUnits(units));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.update).not.toHaveBeenCalled();
  });
});
