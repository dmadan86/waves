/**
 * WAV-02 / M2 / L4 / oracle: receipt scans were counted by reading
 * usage_events and comparing in the edge function (check-then-spend), so a
 * burst at limit-1 all passed; usage_events was INSERT/UPDATE-granted to
 * authenticated; waves_scans_used_this_month(uuid) answered for anyone.
 *
 * Now `waves_receipt_scan_reserve` is one atomic INSERT ... ON CONFLICT ...
 * WHERE count < limit on ai_usage, the events table is read-only for clients,
 * and the count is the caller's own.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, expectDenied, seedGroup } from '../helpers';

let client: Client;
let a: string;
let b: string;
let groupId: string;

beforeAll(async () => {
  client = await connect();
  const g = await seedGroup(client, { memberCount: 2 });
  [a, b] = g.profileIds as [string, string];
  groupId = g.groupId;
});
afterAll(async () => {
  await client.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [[a, b]]).catch(() => null);
  await client.end();
});
beforeEach(async () => {
  await client.query(`DELETE FROM ai_usage WHERE profile_id = ANY($1::uuid[])`, [[a, b]]);
  await client.query(`DELETE FROM usage_events WHERE profile_id = ANY($1::uuid[])`, [[a, b]]);
  await client.query(`DELETE FROM subscriptions WHERE profile_id = ANY($1::uuid[])`, [[a, b]]);
});

const reserve = async (c: Client, id: string) =>
  (await c.query(`SELECT waves_receipt_scan_reserve($1) AS q`, [id])).rows[0].q as {
    allowed: boolean;
    used: number;
    limit: number;
    tier: string;
    month: string;
  };

describe('WAV-02 one scan is one atomic reservation', () => {
  it('reserves up to the Free twenty, then refuses without counting', async () => {
    for (let i = 1; i <= 20; i += 1) {
      expect(await reserve(client, a)).toMatchObject({
        allowed: true,
        used: i,
        limit: 20,
        tier: 'free',
      });
    }
    expect(await reserve(client, a)).toMatchObject({ allowed: false, used: 20, limit: 20 });
    const { rows } = await client.query(
      `SELECT count FROM ai_usage WHERE profile_id = $1 AND feature = 'receipt_scan'`,
      [a],
    );
    expect(rows[0].count).toBe(20);
  });

  it('never lets a parallel burst at the last scan through more than once', async () => {
    const other = await connect();
    try {
      await client.query(
        `INSERT INTO ai_usage (profile_id, month, feature, count)
         VALUES ($1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 'receipt_scan', 19)`,
        [a],
      );
      const results = await Promise.all(
        [client, other, client, other, client, other, client, other].map((c) => reserve(c, a)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(1);
      const { rows } = await client.query(
        `SELECT count FROM ai_usage WHERE profile_id = $1 AND feature = 'receipt_scan'`,
        [a],
      );
      expect(rows[0].count).toBe(20);
    } finally {
      await other.end();
    }
  });

  it('gives Pro the Pro allowance and names the month for a refund', async () => {
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
       VALUES ($1, 'pro', 'monthly', 'active', now() + interval '20 days', 'play')`,
      [b],
    );
    const r = await reserve(client, b);
    expect(r).toMatchObject({ allowed: true, used: 1, limit: 300 });
    expect(r.month).toMatch(/^\d{4}-\d{2}$/);
    expect(
      (
        await client.query(`SELECT waves_ai_usage_refund($1, 'receipt_scan', $2) AS n`, [
          b,
          r.month,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('the recorder does not count a reserved scan twice, and still counts an unreserved one', async () => {
    const record = (reserved: boolean) =>
      client.query(
        `SELECT waves_record_receipt($1, NULL, $2, 'camera', 'g/r.jpg', NULL, '{}'::jsonb, 'parsed', 10, 5, false, $3)`,
        [groupId, a, reserved],
      );
    await reserve(client, a);
    await record(true);
    const used = async () =>
      (await client.query(`SELECT waves_scans_used_this_month($1) AS n`, [a])).rows[0].n as number;
    expect(await used()).toBe(1);
    await record(false);
    expect(await used()).toBe(2);
  });

  it('a signed-in caller reads only their own count, whatever id they pass (oracle closed)', async () => {
    await reserve(client, a);
    await reserve(client, a);
    const seen = await asRole(
      client,
      'authenticated',
      { sub: b, role: 'authenticated' },
      async () => {
        const { rows } = await client.query(`SELECT waves_scans_used_this_month($1) AS n`, [a]);
        return rows[0].n as number;
      },
    );
    expect(seen).toBe(0);
    const own = await asRole(
      client,
      'authenticated',
      { sub: a, role: 'authenticated' },
      async () => {
        const { rows } = await client.query(`SELECT waves_scans_used_this_month($1) AS n`, [b]);
        return rows[0].n as number;
      },
    );
    expect(own).toBe(2);
  });

  it('L4: a client cannot insert into or update usage_events at the grant (not only by policy)', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const { rows } = await client.query(
        `SELECT has_table_privilege($1, 'public.usage_events', 'INSERT') AS i,
                has_table_privilege($1, 'public.usage_events', 'UPDATE') AS u,
                has_table_privilege($1, 'public.usage_events', 'DELETE') AS d`,
        [role],
      );
      expect(rows[0], role).toEqual({ i: false, u: false, d: false });
    }
    const denied = await asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, () =>
      expectDenied(
        client.query(
          `INSERT INTO usage_events (id, profile_id, kind) VALUES ($1, $2, 'receipt_scan')`,
          [randomUUID(), a],
        ),
      ),
    );
    expect(denied).toMatch(/permission denied/i);
  });

  it('the reservation and the legacy counter are service-role only', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await client.query(
        `SELECT has_function_privilege($1, 'public.waves_receipt_scan_reserve(uuid)', 'EXECUTE') AS ok`,
        [role],
      );
      expect(rows[0].ok, role).toBe(false);
    }
  });
});
