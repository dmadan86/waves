/**
 * The RevenueCat webhook's write path, `waves_revenuecat_apply`, and the Plus /
 * Pro reading of "paid" that migration 20261008120000 settles.
 *
 * Pinned: an event id is applied once and only once; an older event delivered
 * late cannot undo a newer one; an id that is not one of our profiles is
 * recorded and refused without a write; a transfer moves store rows but not a
 * promo grant; Plus is paid but keeps the free voice allowance, Pro gets Pro's;
 * and no client can call the function.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedGroup, type SeededGroup } from './helpers';

let client: Client;
let group: SeededGroup;

beforeAll(async () => {
  client = await connect();
  group = await seedGroup(client, { memberCount: 2, name: 'RevenueCat' });
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.query(`DELETE FROM subscriptions WHERE profile_id = ANY($1::uuid[])`, [
    group.profileIds,
  ]);
  await client.query(`DELETE FROM voice_agent_usage WHERE profile_id = ANY($1::uuid[])`, [
    group.profileIds,
  ]);
});

const me = () => group.profileIds[0]!;
const other = () => group.profileIds[1]!;

function upsert(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'upsert',
    tier: 'plus',
    period: 'monthly',
    status: 'active',
    current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    store: 'play',
    store_txn_id: `GPA.${randomUUID()}`,
    price_minor: 4900,
    currency: 'INR',
    country_code: 'IN',
    ...over,
  };
}

async function apply(
  action: Record<string, unknown>,
  opts: { id?: string; type?: string; user?: string; at?: Date } = {},
): Promise<string> {
  const { rows } = await client.query(
    `SELECT waves_revenuecat_apply($1, $2, $3, $4, $5::jsonb) AS outcome`,
    [
      opts.id ?? randomUUID(),
      opts.type ?? 'INITIAL_PURCHASE',
      opts.user ?? me(),
      (opts.at ?? new Date()).toISOString(),
      JSON.stringify(action),
    ],
  );
  return rows[0].outcome as string;
}

async function rowsFor(profileId: string) {
  const { rows } = await client.query(
    `SELECT tier, status, store, store_txn_id, price_minor FROM subscriptions WHERE profile_id = $1`,
    [profileId],
  );
  return rows as { tier: string; status: string; store: string; store_txn_id: string }[];
}

async function isPaid(profileId: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT waves_profile_is_paid($1) AS paid`, [profileId]);
  return rows[0].paid as boolean;
}

async function myPlan(profileId: string): Promise<Record<string, unknown>> {
  const { rows } = await client.query(`SELECT waves_my_plan($1) AS plan`, [profileId]);
  return rows[0].plan as Record<string, unknown>;
}

describe('waves_revenuecat_apply', () => {
  it('writes a purchase, and a replayed event id changes nothing', async () => {
    const id = randomUUID();
    const action = upsert();
    expect(await apply(action, { id })).toBe('applied');
    expect(await apply({ ...action, status: 'expired' }, { id })).toBe('duplicate');
    const rows = await rowsFor(me());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('active');
  });

  it('updates the same store row on renewal and refuses an older event delivered late', async () => {
    const txn = `GPA.${randomUUID()}`;
    const t0 = new Date(Date.now() - 60_000);
    const t1 = new Date();
    expect(await apply(upsert({ store_txn_id: txn }), { at: t0 })).toBe('applied');
    expect(
      await apply(upsert({ store_txn_id: txn, status: 'expired' }), { type: 'EXPIRATION', at: t1 }),
    ).toBe('applied');
    expect(
      await apply(upsert({ store_txn_id: txn, status: 'active' }), { type: 'RENEWAL', at: t0 }),
    ).toBe('stale');
    const rows = await rowsFor(me());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('expired');
  });

  it('records but does not write for an id that is not a profile', async () => {
    const id = randomUUID();
    expect(await apply(upsert(), { id, user: '$RCAnonymousID:abc' })).toBe('unknown_profile');
    expect(await apply(upsert(), { user: randomUUID() })).toBe('unknown_profile');
    const { rows } = await client.query(`SELECT outcome FROM revenuecat_events WHERE id = $1`, [
      id,
    ]);
    expect(rows[0].outcome).toBe('unknown_profile');
  });

  it('records an ignored event once', async () => {
    const id = randomUUID();
    expect(await apply({ kind: 'ignore' }, { id, type: 'TEST' })).toBe('ignored');
    expect(await apply({ kind: 'ignore' }, { id, type: 'TEST' })).toBe('duplicate');
  });

  it('moves store purchases on TRANSFER, but not a promo grant', async () => {
    await apply(upsert({ store: 'appstore' }), { user: other() });
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
       VALUES ($1, 'plus', 'monthly', 'active', now() + interval '30 days', 'promo')`,
      [other()],
    );
    expect(
      await apply(
        { kind: 'transfer', from: [other(), '$RCAnonymousID:x'], to: me() },
        {
          type: 'TRANSFER',
        },
      ),
    ).toBe('applied');
    expect((await rowsFor(me())).map((r) => r.store)).toEqual(['appstore']);
    expect((await rowsFor(other())).map((r) => r.store)).toEqual(['promo']);
  });

  it('cannot be called by a client', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: me(), role: 'authenticated' }),
      ]);
      await client.query('SET LOCAL ROLE authenticated');
      const message = await expectDenied(
        client.query(`SELECT waves_revenuecat_apply('x', 'INITIAL_PURCHASE', $1, now(), $2)`, [
          me(),
          JSON.stringify(upsert()),
        ]),
      );
      expect(message).toMatch(/permission denied/);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});

describe('Plus and Pro', () => {
  it('counts Plus and Pro, active or in grace, as paid; a free row is not', async () => {
    expect(await isPaid(me())).toBe(false);
    await apply(upsert({ tier: 'free' }));
    expect(await isPaid(me())).toBe(false);
    await apply(upsert({ tier: 'plus', status: 'grace' }));
    expect(await isPaid(me())).toBe(true);
    await apply(upsert({ tier: 'pro', status: 'active' }), { user: other() });
    expect(await isPaid(other())).toBe(true);
  });

  it('says which paid plan in waves_my_plan, keeping tier=plus for older readers', async () => {
    await apply(upsert({ tier: 'plus' }));
    expect(await myPlan(me())).toMatchObject({ tier: 'plus', plan: 'plus', scanLimit: 300 });
    await apply(upsert({ tier: 'pro' }));
    expect(await myPlan(me())).toMatchObject({ tier: 'plus', plan: 'pro' });
    expect(await myPlan(other())).toMatchObject({ tier: 'free', plan: 'free' });
  });

  it('gives Plus the free voice allowance and Pro the Pro one', async () => {
    await apply(upsert({ tier: 'plus' }));
    await apply(upsert({ tier: 'pro' }), { user: other() });
    const quota = async (id: string) =>
      (await client.query(`SELECT waves_voice_agent_quota($1, 10, 150) AS q`, [id])).rows[0].q;
    expect(await quota(me())).toMatchObject({ tier: 'plus', limit: 10 });
    expect(await quota(other())).toMatchObject({ tier: 'pro', limit: 150 });
  });
});
