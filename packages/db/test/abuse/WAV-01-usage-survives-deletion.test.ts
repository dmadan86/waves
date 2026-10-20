/**
 * WAV-01: deleting the profile (waves_delete_my_account, callable directly)
 * cascaded every meter away, and re-creating the row started the month again.
 *
 * Now the month is snapshotted into usage_carryover on deletion and restored
 * onto the next profile for the same auth user (trigger on profiles) or the
 * same verified identity (waves_identity_after_verify, what the auth trigger
 * runs). Before the fix the "after" reservations below were allowed.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from '../helpers';
import { asUser, month, person, stubAuthUsers } from './_people';

let client: Client;

beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client.end();
});
beforeEach(async () => {
  await client.query('BEGIN');
  await stubAuthUsers(client);
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

const voice = async (id: string, free = 10) =>
  (await client.query(`SELECT waves_voice_agent_quota($1, $2) AS q`, [id, free])).rows[0].q as {
    allowed: boolean;
    used: number;
  };
const scan = async (id: string) =>
  (await client.query(`SELECT waves_receipt_scan_reserve($1) AS q`, [id])).rows[0].q as {
    allowed: boolean;
    used: number;
  };
const deleteAccount = (id: string) =>
  asUser(client, id, () => client.query(`SELECT waves_delete_my_account()`));

describe('WAV-01 the month survives "delete and start again"', () => {
  it('same auth user: the profile row re-created after the RPC keeps its spent voice commands', async () => {
    const me = await person(client);
    for (let i = 0; i < 3; i += 1) expect((await voice(me, 3)).allowed).toBe(true);
    expect((await voice(me, 3)).allowed).toBe(false);

    await deleteAccount(me);
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM voice_agent_usage WHERE profile_id = $1`,
          [me],
        )
      ).rows[0].n,
    ).toBe(0);
    const carried = await client.query(
      `SELECT feature, amount::int AS amount FROM usage_carryover WHERE auth_user_id = $1 AND month = $2`,
      [me, month()],
    );
    expect(carried.rows).toEqual(expect.arrayContaining([{ feature: 'voice:count', amount: 3 }]));

    // What the loophole did: insert the profile again (profiles_insert_self lets a client).
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Again', 'INR')`,
      [me],
    );
    expect(await voice(me, 3)).toMatchObject({ allowed: false, used: 3 });
  });

  it('same auth user: receipt scans, stream mints and follow-ups come back too', async () => {
    const me = await person(client);
    for (let i = 0; i < 20; i += 1) expect((await scan(me)).allowed).toBe(true);
    expect((await scan(me)).allowed).toBe(false);
    await client.query(
      `INSERT INTO voice_agent_usage (profile_id, month, count, stream_mints, followups)
       VALUES ($1, $2, 0, 7, 4) ON CONFLICT (profile_id, month) DO UPDATE SET stream_mints = 7, followups = 4`,
      [me, month()],
    );

    await deleteAccount(me);
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Again', 'INR')`,
      [me],
    );
    expect(await scan(me)).toMatchObject({ allowed: false, used: 20 });
    const { rows } = await client.query(
      `SELECT stream_mints, followups FROM voice_agent_usage WHERE profile_id = $1 AND month = $2`,
      [me, month()],
    );
    expect(rows[0]).toEqual({ stream_mints: 7, followups: 4 });
  });

  it('a new auth user with the same verified phone inherits the spent month at verification', async () => {
    const phone = `9177${Math.floor(Math.random() * 1e8)}`;
    const first = await person(client, { phone });
    for (let i = 0; i < 10; i += 1) await voice(first);
    expect((await voice(first)).allowed).toBe(false);
    await deleteAccount(first);
    await client.query(`DELETE FROM auth.users WHERE id = $1`, [first]);

    // Full re-registration: new uuid, same phone. The auth trigger calls this.
    const second = await person(client, { phone });
    await client.query(`SELECT waves_identity_after_verify($1)`, [second]);
    expect(await voice(second)).toMatchObject({ allowed: false, used: 10 });
  });

  it('a different person (different identity, new auth user) starts a fresh month', async () => {
    const first = await person(client);
    for (let i = 0; i < 10; i += 1) await voice(first);
    await deleteAccount(first);
    const other = await person(client);
    await client.query(`SELECT waves_identity_after_verify($1)`, [other]);
    expect(await voice(other)).toMatchObject({ allowed: true, used: 1 });
  });

  it('restoring is idempotent and never lowers a count the new profile already has', async () => {
    const me = await person(client);
    for (let i = 0; i < 2; i += 1) await voice(me);
    await deleteAccount(me);
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Again', 'INR')`,
      [me],
    );
    for (let i = 0; i < 3; i += 1) await voice(me); // 2 restored + 3 = 5
    await client.query(`SELECT waves_usage_restore($1)`, [me]);
    expect(await voice(me)).toMatchObject({ used: 6 });
  });

  it('the carry-over tables and identity tombstones are closed to clients', async () => {
    for (const table of ['usage_carryover', 'identity_tombstones', 'identity_settings']) {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await client.query(
          `SELECT has_table_privilege($1, $2, 'SELECT') AS s, has_table_privilege($1, $2, 'INSERT') AS i`,
          [role, `public.${table}`],
        );
        expect(rows[0], `${role} on ${table}`).toEqual({ s: false, i: false });
      }
    }
    const me = await person(client);
    await deleteAccount(me);
    const tomb = await client.query(
      `SELECT deleted_count FROM identity_tombstones WHERE last_auth_user_id = $1`,
      [me],
    );
    expect(tomb.rows.length).toBeGreaterThan(0);
    expect(tomb.rows.every((r) => r.deleted_count === 1)).toBe(true);
    expect(randomUUID()).toBeTruthy();
  });
});
