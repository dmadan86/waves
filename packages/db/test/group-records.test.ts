/**
 * group_records: rental records kept inside a couple/home group.
 *
 * Pinned: only live members of a couple/home group can touch the rows; a rent
 * receipt tells the partner (never the actor, never twice); and when somebody
 * leaves (or the group is deleted) each person gets their own copy in Personal,
 * with internal references remapped, exactly once.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedGroup, type SeededGroup } from './helpers';

let client: Client;
let couple: SeededGroup;
let elsewhere: SeededGroup;
let trip: SeededGroup;

beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  couple = await seedGroup(client, { memberCount: 2, ghostCount: 1, name: 'Us' });
  await client.query(`UPDATE groups SET type = 'couple' WHERE id = $1`, [couple.groupId]);
  elsewhere = await seedGroup(client, { memberCount: 1, name: 'Elsewhere' });
  trip = await seedGroup(client, { memberCount: 1, name: 'Trip' });
});

async function as<T>(profileId: string, run: () => Promise<T>, role = 'authenticated') {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role }),
  ]);
  await client.query(`SET ROLE ${role}`);
  try {
    return await run();
  } finally {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

const [alice, bob] = [0, 1] as const;

async function put(
  g: SeededGroup,
  by: number,
  kind: string,
  data: Record<string, unknown>,
  id = randomUUID(),
) {
  await as(g.profileIds[by]!, () =>
    client.query(
      `INSERT INTO group_records (id, group_id, record_kind, data) VALUES ($1, $2, $3, $4::jsonb)`,
      [id, g.groupId, kind, JSON.stringify(data)],
    ),
  );
  return id;
}

async function count(sql: string, params: unknown[]) {
  const r = await client.query(sql, params);
  return Number(r.rows[0].n);
}

/** property -> tenancy -> recurring -> rent txn, all written by Alice. */
async function seedRental() {
  const property = await put(couple, alice, 'property', { name: 'Flat 2', currency: 'INR' });
  const tenancy = await put(couple, alice, 'tenancy', { propertyId: property, tenantName: 'Ravi' });
  const recurring = await put(couple, alice, 'recurring', { tenancyId: tenancy, amount: '20000' });
  const txn = await put(couple, alice, 'txn', {
    propertyId: property,
    recurringId: recurring,
    category: 'inc.rent',
    amount: '20000',
    currency: 'INR',
    note: 'May rent',
  });
  return { property, tenancy, recurring, txn };
}

describe('access', () => {
  it('lets either live member read and write, and records who created it', async () => {
    const id = await put(couple, alice, 'property', { name: 'Flat' });
    await as(couple.profileIds[bob]!, () =>
      client.query(`UPDATE group_records SET data = '{"name":"Flat B"}' WHERE id = $1`, [id]),
    );
    const seen = await as(couple.profileIds[bob]!, () =>
      client.query(`SELECT data->>'name' AS name, created_by FROM group_records WHERE id = $1`, [
        id,
      ]),
    );
    expect(seen.rows[0].name).toBe('Flat B');
    expect(seen.rows[0].created_by).toBe(couple.memberIds[alice]);
  });

  it('takes the author from the signed-in caller, never from the client', async () => {
    const id = '00000000-0000-4000-8000-0000000000a1';
    await as(couple.profileIds[alice]!, () =>
      client.query(
        `INSERT INTO group_records (id, group_id, record_kind, data, created_by)
         VALUES ($1, $2, 'property', '{"name":"Spoof"}', $3)`,
        [id, couple.groupId, couple.memberIds[bob]],
      ),
    );
    await as(couple.profileIds[bob]!, () =>
      client.query(`UPDATE group_records SET created_by = $2 WHERE id = $1`, [
        id,
        couple.memberIds[bob],
      ]),
    );
    const seen = await client.query(`SELECT created_by FROM group_records WHERE id = $1`, [id]);
    expect(seen.rows[0].created_by).toBe(couple.memberIds[alice]);
  });

  it('refuses outsiders, left members, non-household groups and unknown kinds', async () => {
    const id = await put(couple, alice, 'property', { name: 'Flat' });
    await expectDenied(
      as(elsewhere.profileIds[0]!, () =>
        client.query(
          `INSERT INTO group_records (id, group_id, record_kind) VALUES ($1, $2, 'property')`,
          [randomUUID(), couple.groupId],
        ),
      ),
    );
    const outsider = await as(elsewhere.profileIds[0]!, () =>
      client.query(`SELECT 1 FROM group_records WHERE id = $1`, [id]),
    );
    expect(outsider.rowCount).toBe(0);

    await client.query(`UPDATE group_members SET left_at = now() WHERE id = $1`, [
      couple.memberIds[bob],
    ]);
    await expectDenied(put(couple, bob, 'property', {}));
    const left = await as(couple.profileIds[bob]!, () =>
      client.query(`SELECT 1 FROM group_records WHERE id = $1`, [id]),
    );
    expect(left.rowCount).toBe(0);

    await expectDenied(put(trip, 0, 'property', {}));
    await expectDenied(put(couple, alice, 'loan', {}));
  });
});

describe('rent notification', () => {
  it('logs one activity row and tells the partner once, never the actor, never on update', async () => {
    const { txn } = await seedRental();
    const activity = () =>
      count(`SELECT count(*) n FROM activity_log WHERE group_id = $1 AND verb = 'rent_recorded'`, [
        couple.groupId,
      ]);
    const notified = (p: number) =>
      count(
        `SELECT count(*) n FROM notifications WHERE group_id = $1 AND kind = 'rent_recorded' AND profile_id = $2`,
        [couple.groupId, couple.profileIds[p]],
      );
    expect(await activity()).toBe(1);
    expect(await notified(bob)).toBe(1);
    expect(await notified(alice)).toBe(0);

    await as(couple.profileIds[bob]!, () =>
      client.query(`UPDATE group_records SET data = data || '{"note":"x"}' WHERE id = $1`, [txn]),
    );
    expect(await activity()).toBe(1);
    expect(await notified(alice)).toBe(0);

    await put(couple, alice, 'txn', { category: 'exp.repairs', amount: '500', currency: 'INR' });
    expect(await activity()).toBe(1);
  });
});

describe('grants', () => {
  it('keeps the definer functions away from anon (and the copy away from clients)', async () => {
    await expectDenied(
      as(
        couple.profileIds[alice]!,
        () => client.query(`SELECT waves_can_use_group_records($1)`, [couple.groupId]),
        'anon',
      ),
    );
    for (const role of ['anon', 'authenticated']) {
      await expectDenied(
        as(
          couple.profileIds[alice]!,
          () =>
            client.query(`SELECT waves_copy_group_records_to_personal($1, $2)`, [
              couple.groupId,
              couple.profileIds[alice],
            ]),
          role,
        ),
      );
    }
    await expectDenied(
      as(couple.profileIds[alice]!, () => client.query(`SELECT 1 FROM group_records`), 'anon'),
    );
  });
});

describe('copy to Personal', () => {
  const mine = (profile: string) =>
    client.query(
      `SELECT id, record_kind, data FROM personal_records WHERE owner_user_id = $1 AND data ? 'copiedFrom'`,
      [profile],
    );

  it('copies on leave with fresh ids and remapped references, group rows intact, once', async () => {
    const src = await seedRental();
    const leave = () =>
      client.query(`UPDATE group_members SET left_at = now() WHERE id = $1`, [
        couple.memberIds[bob],
      ]);
    await leave();

    const rows = (await mine(couple.profileIds[bob]!)).rows;
    expect(rows).toHaveLength(4);
    const by = Object.fromEntries(rows.map((r) => [r.data.copiedFrom, r]));
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.size).toBe(4);
    for (const id of Object.values(src)) expect(ids.has(id)).toBe(false);
    expect(by[src.tenancy].data.propertyId).toBe(by[src.property].id);
    expect(by[src.recurring].data.tenancyId).toBe(by[src.tenancy].id);
    expect(by[src.txn].data.propertyId).toBe(by[src.property].id);
    expect(by[src.txn].data.recurringId).toBe(by[src.recurring].id);
    expect(by[src.txn].data.amount).toBe('20000');
    expect(
      await count(
        `SELECT count(*) n FROM group_records WHERE group_id = $1 AND deleted_at IS NULL`,
        [couple.groupId],
      ),
    ).toBe(4);
    expect((await mine(couple.profileIds[alice]!)).rowCount).toBe(0);

    // Rejoin, leave again: nothing doubles.
    await client.query(`UPDATE group_members SET left_at = NULL WHERE id = $1`, [
      couple.memberIds[bob],
    ]);
    await leave();
    expect((await mine(couple.profileIds[bob]!)).rowCount).toBe(4);
  });

  it('skips soft-deleted rows and placeholder members', async () => {
    const src = await seedRental();
    await client.query(`UPDATE group_records SET deleted_at = now() WHERE id = $1`, [src.txn]);
    await client.query(`UPDATE group_members SET left_at = now() WHERE id = $1`, [
      couple.memberIds[2],
    ]);
    await client.query(`UPDATE group_members SET left_at = now() WHERE id = $1`, [
      couple.memberIds[bob],
    ]);
    expect((await mine(couple.profileIds[bob]!)).rowCount).toBe(3);
  });

  it('copies for every live member when the group is deleted', async () => {
    await seedRental();
    await client.query(`UPDATE groups SET deleted_at = now() WHERE id = $1`, [couple.groupId]);
    for (const p of couple.profileIds) expect((await mine(p)).rowCount).toBe(4);
  });
});
