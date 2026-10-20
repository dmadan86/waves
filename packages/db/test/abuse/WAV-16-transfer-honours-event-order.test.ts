/**
 * WAV-16: a RevenueCat TRANSFER moved every store row of the source profiles
 * whatever its store_event_at, so a transfer delivered late could overwrite
 * newer ownership.
 *
 * Now the transfer moves only rows this event is not older than, and answers
 * 'stale' when it moved nothing for that reason.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from '../helpers';

let client: Client;
let from: string;
let to: string;

beforeAll(async () => {
  client = await connect();
  [from, to] = (await seedGroup(client, { memberCount: 2 })).profileIds as [string, string];
});
afterAll(async () => {
  await client
    .query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [[from, to]])
    .catch(() => null);
  await client.end();
});
beforeEach(async () => {
  await client.query(`DELETE FROM subscriptions WHERE profile_id = ANY($1::uuid[])`, [[from, to]]);
});

const transfer = async (at: string) =>
  (
    await client.query(
      `SELECT waves_revenuecat_apply($1, 'TRANSFER', $2, $3::timestamptz, $4::jsonb) AS o`,
      [`evt-${randomUUID()}`, to, at, JSON.stringify({ kind: 'transfer', from: [from], to })],
    )
  ).rows[0].o as string;
const owner = async () =>
  (await client.query(`SELECT profile_id FROM subscriptions WHERE store_txn_id = 'txn-1'`)).rows[0]
    .profile_id as string;

describe('WAV-16 TRANSFER is ordered like every other event', () => {
  it('an older transfer does not move a row with a newer store event, a newer one does', async () => {
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store, store_txn_id, store_event_at)
       VALUES ($1, 'pro', 'monthly', 'active', now() + interval '30 days', 'play', 'txn-1', '2026-10-10T00:00:00Z')`,
      [from],
    );
    expect(await transfer('2026-10-09T00:00:00Z')).toBe('stale');
    expect(await owner()).toBe(from);
    expect(await transfer('2026-10-11T00:00:00Z')).toBe('applied');
    expect(await owner()).toBe(to);
  });

  it('a promo grant and a trial never move', async () => {
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store, store_txn_id)
       VALUES ($1, 'pro', 'monthly', 'active', now() + interval '30 days', 'promo', 'txn-1'),
              ($1, 'pro', 'monthly', 'active', now() + interval '15 days', 'trial', 'trial:' || $1::text)`,
      [from],
    );
    expect(await transfer('2026-10-11T00:00:00Z')).toBe('applied');
    expect(await owner()).toBe(from);
  });
});
