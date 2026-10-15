/**
 * receipt_parse_cache: the exact-match cache in front of the receipt model.
 *
 * It holds a hash and parsed JSON, so the properties worth proving are the
 * privacy ones (no client role can read, write or call anything), the key
 * (model, prompt version and currency each miss), retention, and that a cache
 * hit does not spend a person's scan allowance while a real scan still does.
 */

import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, expectDenied, seedGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

const sha = () => createHash('sha256').update(randomUUID()).digest('hex');
const RESULT = { merchant: 'Cafe', grandTotal: 32000 };

const get = (s: string, model = 'm1', version = 'v1', currency = 'INR') =>
  client.query(`SELECT public.waves_receipt_cache_get($1, $2, $3, $4) AS r`, [
    s,
    model,
    version,
    currency,
  ]);
const put = (s: string, model = 'm1', version = 'v1', currency = 'INR', result = RESULT) =>
  client.query(`SELECT public.waves_receipt_cache_put($1, $2, $3, $4, $5)`, [
    s,
    model,
    version,
    currency,
    JSON.stringify(result),
  ]);

describe('receipt_parse_cache privacy', () => {
  it('is closed to anon and authenticated: table and functions', async () => {
    const s = sha();
    for (const role of ['anon', 'authenticated'] as const) {
      const claims = { sub: randomUUID(), role };
      expect(
        await asRole(client, role, claims, () =>
          expectDenied(client.query(`SELECT * FROM public.receipt_parse_cache`)),
        ),
      ).toMatch(/permission denied/i);
      expect(
        await asRole(client, role, claims, () =>
          expectDenied(
            client.query(
              `INSERT INTO public.receipt_parse_cache (sha256, model, schema_version, result)
               VALUES ($1, 'm', 'v', '{}')`,
              [s],
            ),
          ),
        ),
      ).toMatch(/permission denied/i);
      expect(
        await asRole(client, role, claims, () =>
          expectDenied(client.query(`DELETE FROM public.receipt_parse_cache`)),
        ),
      ).toMatch(/permission denied/i);
      for (const call of [
        `SELECT public.waves_receipt_cache_get('${s}', 'm', 'v', '')`,
        `SELECT public.waves_receipt_cache_put('${s}', 'm', 'v', '', '{}'::jsonb)`,
        `SELECT public.waves_prune_receipt_parse_cache()`,
      ]) {
        expect(await asRole(client, role, claims, () => expectDenied(client.query(call)))).toMatch(
          /permission denied/i,
        );
      }
    }
  });

  it('has RLS on and holds no profile or group column', async () => {
    const rls = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.receipt_parse_cache'::regclass`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'receipt_parse_cache'`,
    );
    const names = cols.rows.map((r) => r.column_name as string);
    expect(names.some((n) => /profile|group|user|path|image/.test(n))).toBe(false);
  });

  it('works for service_role', async () => {
    const s = sha();
    await asRole(client, 'service_role', { role: 'service_role' }, async () => {
      await put(s);
      expect((await get(s)).rows[0].r).toEqual(RESULT);
    });
  });
});

describe('receipt_parse_cache key and retention', () => {
  it('misses before a put, hits after, and counts hits', async () => {
    const s = sha();
    expect((await get(s)).rows[0].r).toBeNull();
    await put(s);
    expect((await get(s)).rows[0].r).toEqual(RESULT);
    await get(s);
    const row = await client.query(
      `SELECT hit_count, last_hit_at FROM public.receipt_parse_cache WHERE sha256 = $1`,
      [s],
    );
    expect(row.rows[0].hit_count).toBe(2);
    expect(row.rows[0].last_hit_at).not.toBeNull();
  });

  it('misses when the model, prompt version or currency differs', async () => {
    const s = sha();
    await put(s);
    expect((await get(s, 'other-model')).rows[0].r).toBeNull();
    expect((await get(s, 'm1', 'v2')).rows[0].r).toBeNull();
    expect((await get(s, 'm1', 'v1', 'USD')).rows[0].r).toBeNull();
    expect((await get(s)).rows[0].r).toEqual(RESULT);
  });

  it('ignores entries older than 30 days and the sweep deletes them', async () => {
    const old = sha();
    const fresh = sha();
    await put(old);
    await put(fresh);
    await client.query(
      `UPDATE public.receipt_parse_cache SET created_at = now() - interval '31 days' WHERE sha256 = $1`,
      [old],
    );
    expect((await get(old)).rows[0].r).toBeNull();
    const swept = await client.query(`SELECT public.waves_prune_receipt_parse_cache() AS n`);
    expect(swept.rows[0].n).toBeGreaterThanOrEqual(1);
    const left = await client.query(
      `SELECT sha256 FROM public.receipt_parse_cache WHERE sha256 = ANY($1)`,
      [[old, fresh]],
    );
    expect(left.rows.map((r) => r.sha256)).toEqual([fresh]);
  });

  it('rejects a key that is not a sha256', async () => {
    await expect(put('not-a-hash')).rejects.toThrow(/sha256_shape/);
  });
});

describe('waves_record_receipt p_cached', () => {
  const record = (group: string, profile: string, cached?: boolean) =>
    client.query(
      cached === undefined
        ? `SELECT public.waves_record_receipt($1, NULL, $2, 'camera', 'g/r.jpg', NULL, '{}'::jsonb, 'parsed', 10, 5)`
        : `SELECT public.waves_record_receipt($1, NULL, $2, 'camera', 'g/r.jpg', NULL, '{}'::jsonb, 'parsed', 0, 0, true)`,
      [group, profile],
    );
  const scans = async (profile: string) =>
    (await client.query(`SELECT public.waves_scans_used_this_month($1) AS n`, [profile])).rows[0]
      .n as number;

  it('a real scan counts toward the allowance; a cached one does not but still makes a receipt', async () => {
    const g = await seedGroup(client, { memberCount: 1 });
    const profile = g.profileIds[0]!;
    await record(g.groupId, profile);
    expect(await scans(profile)).toBe(1);
    await record(g.groupId, profile, true);
    expect(await scans(profile)).toBe(1);
    const receipts = await client.query(
      `SELECT count(*)::int AS n FROM receipts WHERE group_id = $1`,
      [g.groupId],
    );
    expect(receipts.rows[0].n).toBe(2);
    const cached = await client.query(
      `SELECT input_tokens, metadata FROM usage_events WHERE profile_id = $1 AND kind = 'receipt_scan_cached'`,
      [profile],
    );
    expect(cached.rows).toHaveLength(1);
    expect(cached.rows[0].input_tokens).toBe(0);
    expect(cached.rows[0].metadata.cached).toBe(true);
  });

  it('is not callable by a client role', async () => {
    const g = await seedGroup(client, { memberCount: 1 });
    for (const role of ['anon', 'authenticated'] as const) {
      const denied = await asRole(client, role, { sub: g.profileIds[0], role }, () =>
        expectDenied(
          client.query(
            `SELECT public.waves_record_receipt($1, NULL, $2, 'camera', NULL, NULL, '{}'::jsonb, 'parsed', 0, 0, true)`,
            [g.groupId, g.profileIds[0]],
          ),
        ),
      );
      expect(denied).toMatch(/permission denied/i);
    }
  });
});
