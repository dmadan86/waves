/**
 * Review H4 of PR #1350: rows stamped before the migration carried only the
 * unsalted hash of the raw email, so an existing me@gmail.com trial did not
 * block m.e+tag@googlemail.com (its legacy hash differs, and the old row had no
 * canonical key). The migration runs waves_identity_backfill once; this pins
 * what it does to such rows.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from '../helpers';
import { person, stubAuthUsers } from './_people';

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
  await client.query(`UPDATE pro_trial_settings SET launched_at = now() - interval '1 day'`);
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

const legacy = async (kind: string, value: string) =>
  (
    await client.query(`SELECT encode(sha256(convert_to($1 || ':' || $2, 'UTF8')), 'hex') AS k`, [
      kind,
      value,
    ])
  ).rows[0].k as string;
const grant = async (id: string) =>
  (await client.query(`SELECT waves_pro_trial_grant($1) AS g`, [id])).rows[0].g as {
    granted: boolean;
    reason?: string;
  };

describe('H4 backfill of rows written before the canonical keys', () => {
  it('gives an old trial row canonical keys (legacy dropped) and device keys, so an alias is refused', async () => {
    const owner = await person(client, {
      phone: null,
      email: 'me@gmail.com',
      deviceId: 'old-phone',
    });
    const legacyKey = await legacy('email', 'me@gmail.com');
    await client.query(
      `INSERT INTO pro_trials (profile_id, outcome, granted_at, expires_at, identity_keys)
       VALUES ($1, 'granted', now() - interval '10 days', now() + interval '5 days', ARRAY[$2::text])`,
      [owner, legacyKey],
    );

    const { rows } = await client.query(`SELECT waves_identity_backfill($1) AS n`, [owner]);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    const row = (
      await client.query(
        `SELECT identity_keys, device_keys FROM pro_trials WHERE profile_id = $1`,
        [owner],
      )
    ).rows[0] as { identity_keys: string[]; device_keys: string[] };
    expect(row.identity_keys).not.toContain(legacyKey);
    expect(row.identity_keys).toHaveLength(1);
    expect(row.device_keys).toHaveLength(1);

    const alias = await person(client, { phone: null, email: 'm.e+tag@googlemail.com' });
    expect(await grant(alias)).toMatchObject({ granted: false, reason: 'IDENTITY_REUSED' });
  });

  it('leaves a row whose auth identity is gone with its legacy keys, which the lookups still match', async () => {
    const phone = `9122${Math.floor(Math.random() * 1e8)}`;
    const gone = randomUUID();
    const legacyKey = await legacy('phone', phone);
    await client.query(
      `INSERT INTO pro_trials (profile_id, outcome, granted_at, expires_at, identity_keys)
       VALUES ($1, 'granted', now() - interval '40 days', now() - interval '25 days', ARRAY[$2::text])`,
      [gone, legacyKey],
    );
    await client.query(`SELECT waves_identity_backfill(NULL)`);
    const row = (
      await client.query(`SELECT identity_keys FROM pro_trials WHERE profile_id = $1`, [gone])
    ).rows[0] as { identity_keys: string[] };
    expect(row.identity_keys).toEqual([legacyKey]);
    const again = await person(client, { phone });
    expect(await grant(again)).toMatchObject({ granted: false, reason: 'IDENTITY_REUSED' });
  });

  it('stamps the referrer keys and device keys onto old referral rows', async () => {
    const referrer = await person(client, { deviceId: 'ref-phone' });
    const friend = await person(client, { deviceId: 'friend-phone' });
    await client.query(`SELECT waves_referral_code_for($1)`, [referrer]);
    await client.query(
      `INSERT INTO referrals (referrer_id, referee_id, code, status, referrer_days, referee_days)
       VALUES ($1, $2, (SELECT code FROM referral_codes WHERE profile_id = $1), 'rewarded', 7, 7)`,
      [referrer, friend],
    );
    await client.query(`SELECT waves_identity_backfill(NULL)`);
    const row = (
      await client.query(
        `SELECT identity_keys, referrer_keys, device_keys, referrer_device_keys FROM referrals WHERE referee_id = $1`,
        [friend],
      )
    ).rows[0] as Record<string, string[]>;
    expect(row.identity_keys).toHaveLength(1);
    expect(row.referrer_keys).toHaveLength(1);
    expect(row.device_keys).toHaveLength(1);
    expect(row.referrer_device_keys).toHaveLength(1);
    // The lifetime cap now follows the referrer by identity too.
    const earned = await client.query(`SELECT waves_referral_days_earned($1) AS d`, [referrer]);
    expect(earned.rows[0].d).toBe(7);
  });
});
