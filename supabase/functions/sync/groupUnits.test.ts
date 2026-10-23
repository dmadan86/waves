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

/**
 * Legacy stub: no baseUnits in payload, so the non-guarded write path is used.
 * update().eq('id') → Promise<{error}> directly (as the original non-guarded
 * path calls `.update(patch).eq('id', groupId)`).
 */
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

/**
 * Content-guard stub: used when the payload carries `baseUnits`.
 *
 * The guarded write path is:
 *   .update(patch).eq('id', groupId).eq('updated_seq', seq).select('id')
 *
 * The read path is:
 *   .select('units, updated_seq').eq('id', groupId).maybeSingle()
 */
function callerWithUnits(
  myRole: 'admin' | 'member',
  currentUnits: unknown,
  currentSeq: number,
  rowsPerWrite: number[] = [1],
) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve({ data: name === 'waves_my_member_id' ? ME : GROUP_ID, error: null }),
  );

  // update().eq('id').eq('updated_seq').select() → success (count=1)
  let writes = 0;
  const selectAfterWrite = vi.fn(() => {
    const rows = rowsPerWrite[Math.min(writes++, rowsPerWrite.length - 1)] ?? 1;
    return Promise.resolve({ error: null, data: rows ? [{ id: GROUP_ID }] : [] });
  });
  const eqSeq = vi.fn(() => ({ select: selectAfterWrite }));
  const eqId = vi.fn(() => ({ eq: eqSeq }));
  const update = vi.fn(() => ({ eq: eqId }));

  const members = [
    { id: ME, role: myRole },
    { id: RAVI, role: 'member' },
    { id: PRIYA, role: 'member' },
  ];

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = { update };
    // Read path: .select(...).eq('id', groupId).maybeSingle()
    const eqForRead = vi.fn(() => ({
      maybeSingle: () =>
        Promise.resolve({ data: { units: currentUnits, updated_seq: currentSeq }, error: null }),
      // Also handle the group_members chained resolve
    }));
    builder.select = vi.fn(() => ({
      eq:
        table === 'group_members'
          ? () => Promise.resolve({ data: members, error: null })
          : eqForRead,
    }));
    builder.eq = vi.fn(() =>
      table === 'group_members'
        ? Promise.resolve({ data: members, error: null })
        : {
            maybeSingle: () =>
              Promise.resolve({
                data: { units: currentUnits, updated_seq: currentSeq },
                error: null,
              }),
          },
    );
    builder.maybeSingle = () =>
      Promise.resolve({ data: { units: currentUnits, updated_seq: currentSeq }, error: null });
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

  it('stores child weights and omits default adult weights', async () => {
    const scoped = caller('admin');
    const session = new SyncSession(scoped.client, service(), OWNER);
    expect(
      await session.apply(
        updateUnits({
          sharma: { name: 'Sharma', members: [RAVI, PRIYA], weights: { [RAVI]: 1, [PRIYA]: 0.5 } },
        }),
      ),
    ).toMatchObject({ status: 'applied' });
    expect(scoped.update).toHaveBeenCalledWith({
      units: { sharma: { name: 'Sharma', members: [RAVI, PRIYA], weights: { [PRIYA]: 0.5 } } },
    });
  });

  it.each([0, -1, 10.01, '0.5', null, NaN, Infinity])(
    'rejects invalid member weight %s',
    async (weight) => {
      const scoped = caller('admin');
      const session = new SyncSession(scoped.client, service(), OWNER);
      expect(
        await session.apply(
          updateUnits({ sharma: { name: 'Sharma', members: [RAVI], weights: { [RAVI]: weight } } }),
        ),
      ).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
      expect(scoped.update).not.toHaveBeenCalled();
    },
  );

  it('rejects a weight naming someone outside that family', async () => {
    const scoped = caller('admin');
    const session = new SyncSession(scoped.client, service(), OWNER);
    expect(
      await session.apply(
        updateUnits({ sharma: { name: 'Sharma', members: [RAVI], weights: { [PRIYA]: 0.5 } } }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.update).not.toHaveBeenCalled();
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

describe('group.update units — content guard (baseUnits)', () => {
  const goodUnits = { sharma: { name: 'Sharma family', members: [RAVI, PRIYA], head: PRIYA } };

  function updateUnitsWithBase(units: unknown, baseUnits: unknown) {
    return {
      clientMutationId: 'base-1',
      kind: 'group.update',
      groupId: GROUP_ID,
      seq: 1,
      clientCreatedAt: '2026-10-25T02:20:00.000Z',
      payload: { units, baseUnits },
    } as never;
  }

  it('rejects with UNITS_CONFLICT when baseUnits differ from the current DB value', async () => {
    // DB has a different families map than the client's base — stale.
    const differentUnits = { other: { name: 'Other family', members: [RAVI] } };
    const scoped = callerWithUnits('admin', differentUnits, 5);
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(updateUnitsWithBase(goodUnits, null));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'UNITS_CONFLICT' });
    expect(scoped.update).not.toHaveBeenCalled();
  });

  it('applies when baseUnits match the current DB value', async () => {
    // DB has the same units as the client's base → apply.
    const scoped = callerWithUnits('admin', goodUnits, 5);
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(updateUnitsWithBase(goodUnits, goodUnits));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.update).toHaveBeenCalled();
  });

  it('keeps retrying lost races while the families still match, never a false conflict', async () => {
    // Units still match, but another write lands between read and update every time.
    const scoped = callerWithUnits('admin', goodUnits, 5, [0]);
    const session = new SyncSession(scoped.client, service(), OWNER);

    await expect(
      session.apply(updateUnitsWithBase(goodUnits, goodUnits)),
    ).resolves.not.toMatchObject({ code: 'UNITS_CONFLICT' });
    expect(scoped.update).toHaveBeenCalledTimes(5);
  });

  it('applies on the retry when only the first conditional write loses the race', async () => {
    const scoped = callerWithUnits('admin', goodUnits, 5, [0, 1]);
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(updateUnitsWithBase(goodUnits, goodUnits));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.update).toHaveBeenCalledTimes(2);
  });

  it('applies when another admin renamed the group (seq bumped, units same)', async () => {
    // Another admin changed the group name → updated_seq is higher, but units
    // content is unchanged. The content guard must still allow the edit.
    const scoped = callerWithUnits('admin', goodUnits, 99 /* high seq from rename */);
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(updateUnitsWithBase(goodUnits, goodUnits));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.update).toHaveBeenCalled();
  });

  it('applies when baseUnits and DB units differ only in key order', async () => {
    // Same content, different insertion order: { a, b } vs { b, a }.
    const dbUnits = {
      sharma: { name: 'Sharma', members: [RAVI, PRIYA] },
      gupta: { name: 'Gupta', members: [ME] },
    };
    const baseWithDifferentOrder = {
      gupta: { name: 'Gupta', members: [ME] },
      sharma: { name: 'Sharma', members: [RAVI, PRIYA] },
    };
    const scoped = callerWithUnits('admin', dbUnits, 3);
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(updateUnitsWithBase(goodUnits, baseWithDifferentOrder));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.update).toHaveBeenCalled();
  });

  it('applies without a content check when baseUnits is absent (older build)', async () => {
    // No baseUnits in the payload — legacy path, no guard, no DB read for units.
    // Uses the legacy caller() which does the non-guarded simple write.
    const scoped = caller('admin');
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(updateUnits(goodUnits));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.update).toHaveBeenCalled();
  });
});
