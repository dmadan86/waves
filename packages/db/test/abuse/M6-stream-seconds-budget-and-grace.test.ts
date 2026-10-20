/**
 * M6 / H1: the only bound on Deepgram minutes was the count of stream mints;
 * the measured seconds (waves_voice_stream_seconds) were recorded but never
 * refused on. L5: a subscription in grace (a card retry) was metered as Free.
 *
 * Now waves_voice_stream_mint also stops at a seconds budget, and grace is
 * paid in the voice quota, the mint and the follow-up meter.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from '../helpers';

let client: Client;
let a: string;

beforeAll(async () => {
  client = await connect();
  a = (await seedGroup(client, { memberCount: 1 })).profileIds[0]!;
});
afterAll(async () => {
  await client.query(`DELETE FROM profiles WHERE id = $1`, [a]).catch(() => null);
  await client.end();
});
beforeEach(async () => {
  await client.query(`DELETE FROM voice_agent_usage WHERE profile_id = $1`, [a]);
  await client.query(`DELETE FROM voice_agent_followup_slots WHERE profile_id = $1`, [a]);
  await client.query(`DELETE FROM subscriptions WHERE profile_id = $1`, [a]);
});

const subscribe = (status: string) =>
  client.query(
    `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
     VALUES ($1, 'pro', 'monthly', $2, now() + interval '30 days', 'play')`,
    [a, status],
  );
const mint = async (secondsBudget: number | null = null) =>
  (
    await client.query(`SELECT waves_voice_stream_mint($1, 30, 300, 300, 60, $2) AS m`, [
      a,
      secondsBudget,
    ])
  ).rows[0].m as { allowed: boolean; reason?: string; mints: number };

describe('M6 the stream seconds budget', () => {
  it('refuses a mint once the measured seconds reach the budget, before counting it', async () => {
    await subscribe('active');
    expect(await mint(40)).toMatchObject({ allowed: true, mints: 1 });
    await client.query(`SELECT waves_voice_stream_seconds($1, 20)`, [a]);
    expect(await mint(40)).toMatchObject({ allowed: true, mints: 2 });
    await client.query(`SELECT waves_voice_stream_seconds($1, 20)`, [a]);
    expect(await mint(40)).toMatchObject({ allowed: false, reason: 'seconds_budget', mints: 2 });
    const { rows } = await client.query(
      `SELECT stream_mints FROM voice_agent_usage WHERE profile_id = $1`,
      [a],
    );
    expect(rows[0].stream_mints).toBe(2);
  });

  it('defaults the seconds budget to 20 s per mint in the budget', async () => {
    await subscribe('active');
    await client.query(`SELECT waves_voice_stream_seconds($1, 30)`, [a]);
    for (let i = 0; i < 199; i += 1)
      await client.query(`SELECT waves_voice_stream_seconds($1, 30)`, [a]);
    // 200 x 30 s = 6000 s = 300 mints x 20 s: the default ceiling.
    expect(await mint()).toMatchObject({ allowed: false, reason: 'seconds_budget' });
  });
});

describe('L5 grace is paid', () => {
  it('meters a subscription in grace as Pro: commands, streams and follow-ups', async () => {
    await subscribe('grace');
    const quota = await client.query(`SELECT waves_voice_agent_quota($1) AS q`, [a]);
    expect(quota.rows[0].q).toMatchObject({ tier: 'pro', limit: 100, allowed: true });
    expect(await mint()).toMatchObject({ allowed: true });
    await client.query(`SELECT waves_voice_agent_followup_open($1, 3, 600)`, [a]);
    const followup = await client.query(`SELECT waves_voice_agent_followup($1, 'e1') AS r`, [a]);
    expect(followup.rows[0].r).toMatchObject({ tier: 'pro', allowed: true });
  });
});
