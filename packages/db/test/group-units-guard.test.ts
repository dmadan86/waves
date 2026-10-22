/**
 * `groups.units` through the one door /sync does not stand in front of: a
 * bare PostgREST PATCH as `authenticated`. `waves_guard_group_columns` has to
 * refuse a non-admin, and `waves_check_group_units` has to refuse every shape
 * the clients would choke on — `{"u": {}}` most of all, a family with no
 * member list — because the map is read on every phone in the group.
 *
 * Same shape as group-column-guard.test.ts: `SET ROLE authenticated` and a
 * plain UPDATE, since that is exactly what the RPC-less write looks like.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

async function asUser<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query(`SET ROLE authenticated`);
  try {
    return await run();
  } finally {
    await client.query(`RESET ROLE`);
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

function setUnits(profileId: string, groupId: string, units: unknown) {
  return asUser(profileId, () =>
    client.query(`UPDATE groups SET units = $1::jsonb WHERE id = $2`, [
      JSON.stringify(units),
      groupId,
    ]),
  );
}

async function storedUnits(groupId: string): Promise<unknown> {
  const { rows } = await client.query(`SELECT units FROM groups WHERE id = $1`, [groupId]);
  return rows[0]?.units ?? null;
}

describe('groups.units through a direct write', () => {
  it('stores a well-formed map for an admin and writes one families activity row', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 3 });
    const units = {
      sharma: { name: 'Sharma family', members: [memberIds[1], memberIds[2]], head: memberIds[2] },
    };

    await setUnits(profileIds[0]!, groupId, units);

    expect(await storedUnits(groupId)).toEqual(units);
    const { rows } = await client.query(
      `SELECT payload FROM activity_log
        WHERE group_id = $1 AND verb = 'group_updated' AND payload ->> 'field' = 'families'`,
      [groupId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ from: 0, to: 1 });
  });

  it('refuses an ordinary member', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });

    const message = await expectDenied(
      setUnits(profileIds[1]!, groupId, { u: { name: 'Us', members: [memberIds[1]] } }),
    );

    expect(message).toMatch(/NOT_AN_ADMIN/);
    expect(await storedUnits(groupId)).toBeNull();
  });

  it.each([
    ['a family with no member list', () => ({ u: {} })],
    ['a family with an empty member list', () => ({ u: { name: 'Us', members: [] } })],
    ['a blank name', (m: string[]) => ({ u: { name: '   ', members: [m[1]] } })],
    ['a 25-character name', (m: string[]) => ({ u: { name: 'x'.repeat(25), members: [m[1]] } })],
    ['a member that is not an id', () => ({ u: { name: 'Us', members: ['not-a-uuid'] } })],
    ['someone from another group', () => ({ u: { name: 'Us', members: [randomUUID()] } })],
    [
      'a person in two families',
      (m: string[]) => ({
        a: { name: 'A', members: [m[1]] },
        b: { name: 'B', members: [m[1]] },
      }),
    ],
    [
      'a head outside the family',
      (m: string[]) => ({ u: { name: 'Us', members: [m[1]], head: m[2] } }),
    ],
    ['a list instead of a map', (m: string[]) => [{ name: 'Us', members: [m[1]] }]],
  ])('refuses %s even from an admin', async (_label, build) => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 3 });

    const message = await expectDenied(setUnits(profileIds[0]!, groupId, build(memberIds)));

    expect(message).toMatch(/INVALID_UNITS/);
    expect(await storedUnits(groupId)).toBeNull();
  });

  it('lets an admin clear the families with NULL', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    await setUnits(profileIds[0]!, groupId, { u: { name: 'Us', members: [memberIds[1]] } });

    await asUser(profileIds[0]!, () =>
      client.query(`UPDATE groups SET units = NULL WHERE id = $1`, [groupId]),
    );

    expect(await storedUnits(groupId)).toBeNull();
  });
});
