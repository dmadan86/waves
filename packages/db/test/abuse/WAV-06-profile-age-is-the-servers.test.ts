/**
 * WAV-06 / L2: profiles.created_at was client-writable (profiles_update_self
 * grants UPDATE on the row) and the ad rule "account at least 7 days old" read
 * it; it was also the guest-install time, so a week-old guest who signed up
 * today was eligible at once.
 *
 * Now a client role can neither set nor move created_at, and eligibility ages
 * the account from verification (waves_referral_joined_at).
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect } from '../helpers';
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
  await client.query(
    `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'ads_rewarded'`,
  );
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

const createdAt = async (id: string) =>
  (await client.query(`SELECT created_at FROM profiles WHERE id = $1`, [id])).rows[0]
    .created_at as Date;
const eligibility = async (id: string) =>
  (await client.query(`SELECT waves_ads_eligibility($1) AS e`, [id])).rows[0].e as {
    eligible: boolean;
    reason: string | null;
  };

describe('WAV-06 created_at belongs to the server', () => {
  it('a signed-in client cannot backdate their own profile', async () => {
    const me = await person(client);
    const before = await createdAt(me);
    await asRole(client, 'authenticated', { sub: me, role: 'authenticated' }, async () => {
      await client.query(
        `UPDATE profiles SET created_at = now() - interval '400 days' WHERE id = $1`,
        [me],
      );
      const { rows } = await client.query(`SELECT created_at FROM profiles WHERE id = $1`, [me]);
      expect((rows[0].created_at as Date).getTime()).toBe(before.getTime());
    });
  });

  it('a signed-in client inserting their profile gets now(), whatever they send', async () => {
    const id = randomUUID();
    await asRole(client, 'authenticated', { sub: id, role: 'authenticated' }, async () => {
      await client.query(
        `INSERT INTO profiles (id, display_name, default_currency, created_at)
         VALUES ($1, 'Old', 'INR', now() - interval '400 days')`,
        [id],
      );
      const { rows } = await client.query(`SELECT created_at FROM profiles WHERE id = $1`, [id]);
      expect(Date.now() - (rows[0].created_at as Date).getTime()).toBeLessThan(60_000);
    });
  });

  it('the server (no client claims) may still set it, as fixtures and backfills do', async () => {
    const me = await person(client, { profileAgeDays: 30 });
    expect(Date.now() - (await createdAt(me)).getTime()).toBeGreaterThan(29 * 86_400_000);
  });

  it('L2: ad eligibility ages the account from verification, not from the guest profile', async () => {
    // A guest for a month, verified yesterday: too new.
    const fresh = await person(client, { profileAgeDays: 30, verifiedDaysAgo: 1 });
    expect(await eligibility(fresh)).toMatchObject({ eligible: false, reason: 'too_new' });
    // Verified eight days ago: old enough.
    const settled = await person(client, { profileAgeDays: 30, verifiedDaysAgo: 8 });
    expect(await eligibility(settled)).toMatchObject({ eligible: true, reason: null });
  });
});
