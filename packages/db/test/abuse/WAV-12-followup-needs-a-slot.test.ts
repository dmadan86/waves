/**
 * WAV-12 / M1: a follow-up turn was keyed by a client-chosen expense id, so a
 * Pro (or trial) account with its commands spent could rotate the id and buy
 * 300 LLM calls a month outside the allowance.
 *
 * Now a follow-up needs a slot a metered command opened
 * (waves_voice_agent_followup_open: 3 turns, 10 minutes). No slot, no turn,
 * whatever the id says.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from '../helpers';

let client: Client;
let a: string;

beforeAll(async () => {
  client = await connect();
  a = (await seedGroup(client, { memberCount: 1 })).profileIds[0]!;
  await client.query(
    `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
     VALUES ($1, 'pro', 'monthly', 'active', now() + interval '30 days', 'play')`,
    [a],
  );
});
afterAll(async () => {
  await client.query(`DELETE FROM profiles WHERE id = $1`, [a]).catch(() => null);
  await client.end();
});
beforeEach(async () => {
  await client.query(`DELETE FROM voice_agent_followup_slots WHERE profile_id = $1`, [a]);
  await client.query(`DELETE FROM voice_agent_followup_turns WHERE profile_id = $1`, [a]);
  await client.query(`DELETE FROM voice_agent_usage WHERE profile_id = $1`, [a]);
});

const open = async (turns = 3, seconds = 600) =>
  (
    await client.query(`SELECT waves_voice_agent_followup_open($1, $2, $3) AS id`, [
      a,
      turns,
      seconds,
    ])
  ).rows[0].id as string;
const turn = async (c: Client, expense: string) =>
  (await c.query(`SELECT waves_voice_agent_followup($1, $2) AS r`, [a, expense])).rows[0].r as {
    allowed: boolean;
    reason?: string;
    used: number;
  };

describe('WAV-12 follow-ups are bounded by metered commands', () => {
  it('refuses a follow-up with no slot behind it, whatever expense id it names', async () => {
    for (const id of ['e1', 'e2', 'made-up-3']) {
      expect(await turn(client, id)).toMatchObject({ allowed: false, reason: 'no_slot', used: 0 });
    }
    const { rows } = await client.query(
      `SELECT followups FROM voice_agent_usage WHERE profile_id = $1`,
      [a],
    );
    expect(rows).toEqual([]);
  });

  it('one metered command buys three turns, and rotating the id does not buy a fourth', async () => {
    await open(3);
    expect(await turn(client, 'e1')).toMatchObject({ allowed: true, used: 1 });
    expect(await turn(client, 'e2')).toMatchObject({ allowed: true, used: 2 });
    expect(await turn(client, 'e3')).toMatchObject({ allowed: true, used: 3 });
    expect(await turn(client, 'e4')).toMatchObject({ allowed: false, reason: 'no_slot', used: 3 });
  });

  it('a slot expires with its window', async () => {
    const id = await open(3, 600);
    await client.query(
      `UPDATE voice_agent_followup_slots SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [id],
    );
    expect(await turn(client, 'e1')).toMatchObject({ allowed: false, reason: 'no_slot' });
  });

  it('a refused turn (per-expense window) gives the slot turn back', async () => {
    await open(5);
    for (let i = 0; i < 3; i += 1) expect((await turn(client, 'same')).allowed).toBe(true);
    expect(await turn(client, 'same')).toMatchObject({ allowed: false, reason: 'expense_cap' });
    const { rows } = await client.query(
      `SELECT turns_left FROM voice_agent_followup_slots WHERE profile_id = $1`,
      [a],
    );
    expect(rows[0].turns_left).toBe(2);
  });

  it('never lets a parallel burst take more turns than the slot holds', async () => {
    const other = await connect();
    try {
      await open(1);
      const results = await Promise.all(
        [client, other, client, other, client, other].map((c, i) => turn(c, `e${i}`)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(1);
    } finally {
      await other.end();
    }
  });

  it('the slot functions and table are service-role only', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await client.query(
        `SELECT has_function_privilege($1, 'public.waves_voice_agent_followup_open(uuid, integer, integer)', 'EXECUTE') AS f,
                has_table_privilege($1, 'public.voice_agent_followup_slots', 'SELECT') AS t`,
        [role],
      );
      expect(rows[0], role).toEqual({ f: false, t: false });
    }
  });
});
