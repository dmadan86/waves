/**
 * Referral rewards are 50 credits each (20261115090000_referral_credits), no
 * longer Pro days. This pins that a referral grants no subscription, so the
 * plan stays Free, and that a legacy promo row (granted before) still reads as
 * Pro. A Plus row written directly is still stored as Pro (the trigger).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from '../helpers';
import { asUser, expense, group, person, stubAuthUsers } from './_people';

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

describe('referral rewards are credits, not Pro', () => {
  it('pays both sides in the wallet and leaves them on the Free plan', async () => {
    const referrer = await person(client);
    const friend = await person(client);
    const code = (
      (await asUser(client, referrer, () => client.query(`SELECT waves_my_referral() AS r`)))
        .rows[0].r as { code: string }
    ).code;
    await asUser(client, friend, () => client.query(`SELECT waves_claim_referral($1)`, [code]));
    const third = await person(client);
    const g = await group(client, [friend, third]);
    await expense(client, g.groupId, g.members[0]!);

    for (const id of [referrer, friend]) {
      const subs = await client.query(`SELECT 1 FROM subscriptions WHERE profile_id = $1`, [id]);
      expect(subs.rows).toEqual([]);
      const plan = await client.query(`SELECT waves_my_plan($1) AS p`, [id]);
      expect(plan.rows[0].p).toMatchObject({ plan: 'free' });
      const bal = await client.query(`SELECT waves_credit_balance($1) AS c`, [id]);
      expect(bal.rows[0].c).toBe(50);
      const paid = await client.query(`SELECT waves_profile_is_paid($1) AS paid`, [id]);
      expect(paid.rows[0].paid).toBe(false);
    }
  });

  it('a Plus row written directly is stored as Pro (the trigger), so no reader needs a Plus case', async () => {
    const me = await person(client);
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store, store_txn_id)
       VALUES ($1, 'plus', 'monthly', 'active', now() + interval '7 days', 'promo', 'referral:test:referrer')`,
      [me],
    );
    const { rows } = await client.query(`SELECT tier FROM subscriptions WHERE profile_id = $1`, [
      me,
    ]);
    expect(rows[0].tier).toBe('pro');
  });
});
