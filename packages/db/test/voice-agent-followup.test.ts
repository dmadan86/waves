/**
 * The follow-up meter: `waves_voice_agent_followup` decides the plan itself (a
 * Free person is refused and nothing is counted), caps a Pro person at 300 a
 * month and any one expense at 3 per window, and is service-role only.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, expectDenied, seedGroup } from './helpers';

let client: Client;
let a: string;
let b: string;

beforeAll(async () => {
  client = await connect();
  const group = await seedGroup(client, { memberCount: 2 });
  [a, b] = group.profileIds as [string, string];
});

async function reset(): Promise<void> {
  await client.query(`DELETE FROM voice_agent_followup_turns WHERE profile_id = ANY($1::uuid[])`, [
    [a, b],
  ]);
  await client.query(`DELETE FROM voice_agent_usage WHERE profile_id = ANY($1::uuid[])`, [[a, b]]);
  await client.query(`DELETE FROM subscriptions WHERE profile_id = ANY($1::uuid[])`, [[a, b]]);
}
beforeEach(reset);
afterAll(async () => {
  await reset();
  await client.end();
});

async function turn(
  profile: string,
  expense: string,
  month = 300,
  perExpense = 3,
  windowSeconds = 600,
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `SELECT public.waves_voice_agent_followup($1, $2, $3, $4, $5) AS r`,
    [profile, expense, month, perExpense, windowSeconds],
  );
  return rows[0].r as Record<string, unknown>;
}

const subscribe = (profile: string, tier = 'pro') =>
  client.query(
    `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
     VALUES ($1, $2, 'monthly', 'active', now() + interval '30 days', 'play')`,
    [profile, tier],
  );

describe('waves_voice_agent_followup', () => {
  it('refuses a Free person and counts nothing', async () => {
    expect(await turn(a, 'e1')).toMatchObject({
      allowed: false,
      tier: 'free',
      reason: 'free_tier',
    });
    const turns = await client.query(
      `SELECT 1 FROM voice_agent_followup_turns WHERE profile_id = $1`,
      [a],
    );
    const usage = await client.query(`SELECT 1 FROM voice_agent_usage WHERE profile_id = $1`, [a]);
    expect(turns.rowCount).toBe(0);
    expect(usage.rowCount).toBe(0);
  });

  it('refuses a person whose only subscription is a lapsed one', async () => {
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
       VALUES ($1, 'pro', 'monthly', 'active', now() - interval '1 day', 'play')`,
      [a],
    );
    expect(await turn(a, 'e1')).toMatchObject({ allowed: false, reason: 'free_tier' });
  });

  it('admits Pro (and a legacy plus row) and does not touch the command count', async () => {
    await subscribe(a, 'plus');
    expect(await turn(a, 'e1')).toEqual({ used: 1, limit: 300, tier: 'pro', allowed: true });
    const { rows } = await client.query(
      `SELECT count, followups FROM voice_agent_usage WHERE profile_id = $1`,
      [a],
    );
    expect(rows[0]).toEqual({ count: 0, followups: 1 });
  });

  it('caps a Pro person at the month limit and a refused turn costs nothing', async () => {
    await subscribe(a);
    for (let i = 1; i <= 5; i++)
      expect(await turn(a, `e${i}`, 5)).toMatchObject({ allowed: true, used: i });
    expect(await turn(a, 'e6', 5)).toMatchObject({ allowed: false, reason: 'month_cap', used: 5 });
    const { rows } = await client.query(
      `SELECT turns FROM voice_agent_followup_turns WHERE profile_id = $1 AND expense_id = 'e6'`,
      [a],
    );
    expect(rows[0].turns).toBe(0);
  });

  it('allows 300 and refuses the 301st with the default limit', async () => {
    await subscribe(a);
    await client.query(
      `INSERT INTO voice_agent_usage (profile_id, month, count, followups)
       VALUES ($1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 0, 299)`,
      [a],
    );
    const { rows } = await client.query(`SELECT public.waves_voice_agent_followup($1, 'x') AS r`, [
      a,
    ]);
    expect(rows[0].r).toMatchObject({ allowed: true, used: 300 });
    const next = await client.query(`SELECT public.waves_voice_agent_followup($1, 'y') AS r`, [a]);
    expect(next.rows[0].r).toMatchObject({ allowed: false, reason: 'month_cap', used: 300 });
  });

  it('caps one expense at three turns in a window, then lets it through when the window passes', async () => {
    await subscribe(a);
    for (let i = 1; i <= 3; i++) expect(await turn(a, 'e1')).toMatchObject({ allowed: true });
    expect(await turn(a, 'e1')).toMatchObject({ allowed: false, reason: 'expense_cap', used: 3 });
    expect(await turn(a, 'other')).toMatchObject({ allowed: true });
    await client.query(
      `UPDATE voice_agent_followup_turns SET window_start = now() - interval '11 minutes'
        WHERE profile_id = $1 AND expense_id = 'e1'`,
      [a],
    );
    expect(await turn(a, 'e1')).toMatchObject({ allowed: true });
  });

  it('counts per person: another person with the same expense id is not capped by it', async () => {
    await subscribe(a);
    await subscribe(b);
    for (let i = 0; i < 3; i++) await turn(a, 'same');
    expect(await turn(b, 'same')).toMatchObject({ allowed: true, used: 1 });
  });

  it('rejects an empty or oversized expense id', async () => {
    await subscribe(a);
    await expect(turn(a, '')).rejects.toThrow();
    await expect(turn(a, 'x'.repeat(65))).rejects.toThrow();
  });

  it('is callable only by the service role', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expectDenied(
        asRole(client, role, { sub: a, role }, () =>
          client.query(`SELECT public.waves_voice_agent_followup($1, 'e1')`, [a]),
        ),
      );
    }
  });
});
