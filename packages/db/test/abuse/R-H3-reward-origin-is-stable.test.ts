/**
 * Review H3 of PR #1350: a restored ad reward ('carry:<tx>') was snapshotted
 * again on the next deletion, and restored as 'carry:carry:<tx>' beside it —
 * every delete/restore cycle multiplied the credit.
 *
 * Now a carry-over names the ORIGINAL transaction id, is unique on it, and a
 * restore is 'carry:<origin>' whatever the cycle count.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from '../helpers';
import { asUser, person, stubAuthUsers } from './_people';

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

describe('H3 one reward, however many delete/restore cycles', () => {
  it('keeps exactly one ad_rewards row and one carry-over row per original reward', async () => {
    const me = await person(client, { verifiedDaysAgo: 30 });
    const tx = `TX-${randomUUID()}`;
    const granted = await client.query(`SELECT waves_ads_grant($1, 'voice', $2, 'unit') AS g`, [
      me,
      tx,
    ]);
    expect(granted.rows[0].g).toMatchObject({ outcome: 'granted' });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await asUser(client, me, () => client.query(`SELECT waves_delete_my_account()`));
      await client.query(
        `INSERT INTO profiles (id, display_name, default_currency, created_at)
         VALUES ($1, 'Again', 'INR', now() - interval '30 days')`,
        [me],
      );
    }

    const rewards = await client.query(
      `SELECT transaction_id, amount FROM ad_rewards WHERE profile_id = $1`,
      [me],
    );
    expect(rewards.rows).toEqual([{ transaction_id: `carry:${tx}`, amount: 2 }]);
    const carried = await client.query(
      `SELECT ref, amount::int AS amount FROM usage_carryover WHERE feature = 'ad:voice' AND ref = $1`,
      [tx],
    );
    expect(carried.rows).toEqual([{ ref: tx, amount: 2 }]);
    const bonus = await client.query(`SELECT waves_ads_bonus($1, 'voice') AS b`, [me]);
    expect(bonus.rows[0].b).toBe(2);
    const today = await client.query(`SELECT waves_ads_eligibility($1) AS e`, [me]);
    expect(today.rows[0].e).toMatchObject({ usedToday: 1 });
  });

  it('refuses a carry-over that names a restored id rather than its origin', async () => {
    await expect(
      client.query(
        `INSERT INTO usage_carryover (auth_user_id, month, feature, amount, ref)
         VALUES ($1, '2026-10-01', 'ad:voice', 2, 'carry:TX-1')`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/usage_carryover_ref_origin/);
  });
});
