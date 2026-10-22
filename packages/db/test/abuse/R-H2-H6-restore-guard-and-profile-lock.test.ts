/**
 * Review H2 / H6 of PR #1350.
 *
 * H2: a profile inserted for a NEW auth user whose identity was already
 * verified got no restoration (the insert hook matched the auth uid only).
 * Now the insert hook restores by identity too, and every reservation runs
 * waves_usage_guard: no restoration mark, no spend; a restoration that fails
 * refuses the reservation instead of leaving empty meters.
 *
 * H6: deletion, restoration and every reservation share one per-profile
 * advisory lock, so a command cannot land between the snapshot and the
 * cascade.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from '../helpers';
import { asUser, person, stubAuthUsers } from './_people';

let client: Client;

beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client.end();
});

const voice = async (c: Client, id: string) =>
  (await c.query(`SELECT waves_voice_agent_quota($1) AS q`, [id])).rows[0].q as {
    allowed: boolean;
    used: number;
  };

describe('H2 restoration by identity at profile insert, and the guard', () => {
  beforeEach(async () => {
    await client.query('BEGIN');
    await stubAuthUsers(client);
  });
  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  it('restores by identity when the profile is inserted for a new auth user (no verify hook)', async () => {
    const phone = `9133${Math.floor(Math.random() * 1e8)}`;
    const first = await person(client, { phone });
    for (let i = 0; i < 10; i += 1) await voice(client, first);
    await asUser(client, first, () => client.query(`SELECT waves_delete_my_account()`));
    await client.query(`DELETE FROM auth.users WHERE id = $1`, [first]);

    // The auth row (verified phone) exists before the profile row, as it does
    // for an OAuth or phone sign-up; nothing calls waves_identity_after_verify.
    const second = randomUUID();
    await client.query(
      `INSERT INTO auth.users (id, is_anonymous, phone, phone_confirmed_at) VALUES ($1, false, $2, now())`,
      [second, phone],
    );
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Again', 'INR')`,
      [second],
    );
    expect(await voice(client, second)).toMatchObject({ allowed: false, used: 10 });
    const mark = await client.query(`SELECT 1 FROM usage_restore_marks WHERE profile_id = $1`, [
      second,
    ]);
    expect(mark.rowCount).toBe(1);
  });

  it('a reservation with no restoration mark restores first; a failing restoration refuses it', async () => {
    const me = await person(client);
    // A carry-over row for this auth user that cannot be restored (bad feature shape).
    await client.query(
      `INSERT INTO usage_carryover (auth_user_id, month, feature, amount)
       VALUES ($1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 'ai:not a feature!', 1)`,
      [me],
    );
    await client.query(`DELETE FROM usage_restore_marks WHERE profile_id = $1`, [me]);
    await expect(
      client.query(`SELECT waves_ai_usage_reserve($1, 'screenshot_import', 5)`, [me]),
    ).rejects.toThrow(/ai_usage_feature_shape/);
    // Nothing was reserved and no mark was written: the next attempt tries again.
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await stubAuthUsers(client);
    const again = await person(client);
    await client.query(`DELETE FROM usage_restore_marks WHERE profile_id = $1`, [again]);
    const { rows } = await client.query(
      `SELECT waves_ai_usage_reserve($1, 'screenshot_import', 5) AS q`,
      [again],
    );
    expect(rows[0].q).toMatchObject({ allowed: true, used: 1 });
    expect(
      (await client.query(`SELECT 1 FROM usage_restore_marks WHERE profile_id = $1`, [again]))
        .rowCount,
    ).toBe(1);
  });

  it('a mark is tied to the identity: an identity confirmed later restores again at the next reservation', async () => {
    const phone = `9134${Math.floor(Math.random() * 1e8)}`;
    const first = await person(client, { phone });
    for (let i = 0; i < 10; i += 1) await voice(client, first);
    await asUser(client, first, () => client.query(`SELECT waves_delete_my_account()`));
    await client.query(`DELETE FROM auth.users WHERE id = $1`, [first]);

    // A fresh, still-unverified account: restored for the empty identity, spends one.
    const second = randomUUID();
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Guest', 'INR')`,
      [second],
    );
    expect(await voice(client, second)).toMatchObject({ allowed: true, used: 1 });
    const mark = await client.query(
      `SELECT fingerprint FROM usage_restore_marks WHERE profile_id = $1`,
      [second],
    );
    expect(mark.rows[0].fingerprint).toBe('');

    // The phone is confirmed, but the verification hook's restore never ran
    // (it failed and rolled back): the mark still says 'unverified'.
    await client.query(
      `INSERT INTO auth.users (id, is_anonymous, phone, phone_confirmed_at) VALUES ($1, false, $2, now())`,
      [second, phone],
    );
    expect(await voice(client, second)).toMatchObject({ allowed: false, used: 10 });
    const after = await client.query(
      `SELECT fingerprint FROM usage_restore_marks WHERE profile_id = $1`,
      [second],
    );
    expect(after.rows[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('every reservation refuses a profile that does not exist', async () => {
    const ghost = randomUUID();
    for (const call of [
      `SELECT waves_voice_agent_quota($1)`,
      `SELECT waves_ai_usage_reserve($1, 'receipt_scan', 5)`,
      `SELECT waves_voice_stream_mint($1)`,
      `SELECT waves_voice_agent_followup_open($1, 3, 600)`,
      `SELECT waves_statement_import_chunk($1, 'import-0001-abcd', 3)`,
    ]) {
      await expect(client.query(call, [ghost]), call).rejects.toThrow(/NO_SUCH_PROFILE/);
      await client.query('ROLLBACK');
      await client.query('BEGIN');
    }
  });
});

describe('H6 one lock for deletion, restoration and reservations', () => {
  it('a reservation cannot run while the account is being deleted, and fails once it is gone', async () => {
    const { profileIds } = await seedGroup(client, { memberCount: 1 });
    const me = profileIds[0]!;
    const other = await connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: me, role: 'authenticated' }),
      ]);
      await client.query(`SELECT waves_delete_my_account()`);
      // Held by the deletion until it commits.
      await other.query('BEGIN');
      const held = await other.query(
        `SELECT pg_try_advisory_xact_lock(hashtextextended('profile:' || $1::text, 0)) AS got`,
        [me],
      );
      expect(held.rows[0].got).toBe(false);
      await other.query('ROLLBACK');
      await client.query('COMMIT');
      await expect(other.query(`SELECT waves_voice_agent_quota($1)`, [me])).rejects.toThrow(
        /NO_SUCH_PROFILE/,
      );
    } finally {
      await other.end();
    }
  });

  it('the lock functions are service-role only', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await client.query(
        `SELECT has_function_privilege($1, 'public.waves_profile_lock(uuid)', 'EXECUTE') AS l,
                has_function_privilege($1, 'public.waves_usage_guard(uuid)', 'EXECUTE') AS g`,
        [role],
      );
      expect(rows[0], role).toEqual({ l: false, g: false });
    }
  });
});
