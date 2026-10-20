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

describe('M6 / M9 the stream seconds budget is reserved at mint', () => {
  const seconds = async () =>
    Number(
      (
        await client.query(`SELECT stream_seconds FROM voice_agent_usage WHERE profile_id = $1`, [
          a,
        ])
      ).rows[0]?.stream_seconds ?? 0,
    );

  it('reserves 20 s with each mint, atomically, and refuses the mint that would cross the budget', async () => {
    await subscribe('active');
    expect(await mint(40)).toMatchObject({ allowed: true, mints: 1, reserved_seconds: 20 });
    expect(await seconds()).toBe(20);
    expect(await mint(40)).toMatchObject({ allowed: true, mints: 2 });
    expect(await seconds()).toBe(40);
    expect(await mint(40)).toMatchObject({ allowed: false, reason: 'seconds_budget', mints: 2 });
    const { rows } = await client.query(
      `SELECT stream_mints FROM voice_agent_usage WHERE profile_id = $1`,
      [a],
    );
    expect(rows[0].stream_mints).toBe(2);
  });

  it('settling a stream gives the unused reservation back, so the next mint fits', async () => {
    await subscribe('active');
    await mint(40);
    await mint(40);
    await client.query(`SELECT waves_voice_stream_seconds($1, 5, 20)`, [a]);
    expect(await seconds()).toBe(25);
    // A stream that carried nothing settles with 0 and frees its 20 s.
    await client.query(`SELECT waves_voice_stream_seconds($1, 0, 20)`, [a]);
    expect(await seconds()).toBe(5);
    expect(await mint(40)).toMatchObject({ allowed: true, mints: 3 });
    expect(await seconds()).toBe(25);
  });

  it('never lets a parallel burst reserve past the seconds budget', async () => {
    await subscribe('active');
    const other = await connect();
    try {
      const results = await Promise.all(
        [client, other, client, other, client, other].map((c) =>
          c.query(`SELECT waves_voice_stream_mint($1, 30, 300, 300, 60, 40) AS m`, [a]),
        ),
      );
      const allowed = results.filter((r) => (r.rows[0].m as { allowed: boolean }).allowed);
      expect(allowed).toHaveLength(2);
      expect(await seconds()).toBe(40);
    } finally {
      await other.end();
    }
  });

  it('defaults the seconds budget to 20 s per mint in the budget', async () => {
    await subscribe('active');
    await client.query(
      `INSERT INTO voice_agent_usage (profile_id, month, count, stream_seconds)
       VALUES ($1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 0, 5990)`,
      [a],
    );
    // 5990 + 20 > 300 mints x 20 s = 6000: the default ceiling.
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
