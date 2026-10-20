/**
 * Owner decision (Oct 2026): referral rewards are Pro days, not Plus. The
 * grant has written tier 'pro' since 20261016120000_two_tiers_free_and_pro
 * (and the trigger rewrites any 'plus'); this pins that the plan, the voice
 * quota and the stream mint all read a referral-only account as Pro. Rows
 * granted as Plus before that migration are left as they are (the trigger
 * upgraded stored rows then).
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

describe('referral days are Pro', () => {
  it('writes Pro rows for both sides and every reader treats them as Pro', async () => {
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
      const rows = await client.query(
        `SELECT tier, store, status FROM subscriptions WHERE profile_id = $1`,
        [id],
      );
      expect(rows.rows).toEqual([{ tier: 'pro', store: 'promo', status: 'active' }]);
      const plan = await client.query(`SELECT waves_my_plan($1) AS p`, [id]);
      expect(plan.rows[0].p).toMatchObject({ plan: 'pro', scanLimit: 300 });
      const quota = await client.query(`SELECT waves_voice_agent_quota($1) AS q`, [id]);
      expect(quota.rows[0].q).toMatchObject({ tier: 'pro', limit: 100, allowed: true });
      const mint = await client.query(`SELECT waves_voice_stream_mint($1) AS m`, [id]);
      expect(mint.rows[0].m).toMatchObject({ tier: 'pro', allowed: true });
      const paid = await client.query(`SELECT waves_profile_is_paid($1) AS paid`, [id]);
      expect(paid.rows[0].paid).toBe(true);
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
