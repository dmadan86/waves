/**
 * The RevenueCat webhook's write path, `waves_revenuecat_apply`, and the Pro
 * reading of "paid" (a Plus row is stored as Pro since 20261016120000).
 *
 * Pinned: an event id is applied once and only once; an older event delivered
 * late cannot undo a newer one; an id that is not one of our profiles is
 * recorded and refused without a write; a transfer moves store rows but not a
 * promo grant; every paid row, Plus included, gets the Pro voice allowance;
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
  return rows as {
    tier: string;
    status: string;
    store: string;
    store_txn_id: string;
    price_minor: string | null;
  }[];
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

describe('Pro (Plus retired)', () => {
  it('counts Pro (and a legacy Plus), active or in grace, as paid; a free row is not', async () => {
    expect(await isPaid(me())).toBe(false);
    await apply(upsert({ tier: 'free' }));
    expect(await isPaid(me())).toBe(false);
    await apply(upsert({ tier: 'plus', status: 'grace' }));
    expect(await isPaid(me())).toBe(true);
    await apply(upsert({ tier: 'pro', status: 'active' }), { user: other() });
    expect(await isPaid(other())).toBe(true);
  });

  it('says plan=pro for every paid row in waves_my_plan, keeping tier=plus for older readers', async () => {
    await apply(upsert({ tier: 'plus' }));
    expect(await myPlan(me())).toMatchObject({ tier: 'plus', plan: 'pro', scanLimit: 300 });
    await apply(upsert({ tier: 'pro' }));
    expect(await myPlan(me())).toMatchObject({ tier: 'plus', plan: 'pro' });
    expect(await myPlan(other())).toMatchObject({ tier: 'free', plan: 'free' });
  });

  it('gives a Plus event and a Pro event the same Pro voice allowance (100)', async () => {
    await apply(upsert({ tier: 'plus' }));
    await apply(upsert({ tier: 'pro' }), { user: other() });
    const quota = async (id: string) =>
      (await client.query(`SELECT waves_voice_agent_quota($1, 10, 100) AS q`, [id])).rows[0].q;
    expect(await quota(me())).toMatchObject({ tier: 'pro', limit: 100 });
    expect(await quota(other())).toMatchObject({ tier: 'pro', limit: 100 });
    const stored = await client.query(
      `SELECT DISTINCT tier FROM subscriptions WHERE profile_id = ANY($1::uuid[])`,
      [group.profileIds],
    );
    expect(stored.rows).toEqual([{ tier: 'pro' }]);
  });
});

// --- A subscription's life, event by event -----------------------------------
//
// The edge function maps each RevenueCat event to an upsert on the store
// transaction's row (logic.test.ts pins the mapping). These run the resulting
// sequences through the real SQL and read the answer the way the app does:
// waves_profile_is_paid / waves_my_plan.

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

/** One subscription's store transaction, stepped through events. */
function subscription(over: Record<string, unknown> = {}) {
  const txn = `GPA.${randomUUID()}`;
  return (step: Record<string, unknown>) => upsert({ store_txn_id: txn, ...over, ...step });
}

describe('a subscription through its life', () => {
  it('purchase, cancel, expire: paid until the store says it ended', async () => {
    const sub = subscription({ tier: 'pro', current_period_end: ahead(30) });
    await apply(sub({}), { type: 'INITIAL_PURCHASE', at: ago(3) });
    expect(await isPaid(me())).toBe(true);
    expect(await myPlan(me())).toMatchObject({ plan: 'pro', source: 'subscription' });

    // CANCELLATION only switches the renewal off: still paid for what was bought.
    expect(await apply(sub({ status: 'active' }), { type: 'CANCELLATION', at: ago(2) })).toBe(
      'applied',
    );
    expect(await isPaid(me())).toBe(true);
    expect(await myPlan(me())).toMatchObject({ plan: 'pro' });

    // UNCANCELLATION: renewal back on, nothing changes for the person.
    await apply(sub({ status: 'active' }), { type: 'UNCANCELLATION', at: ago(1) });
    expect(await isPaid(me())).toBe(true);

    // EXPIRATION: the store ended it.
    await apply(sub({ status: 'expired', current_period_end: ago(0).toISOString() }), {
      type: 'EXPIRATION',
      at: new Date(),
    });
    expect(await isPaid(me())).toBe(false);
    expect(await myPlan(me())).toMatchObject({ tier: 'free', plan: 'free' });
    expect(await rowsFor(me())).toHaveLength(1);
  });

  it('keeps paying features through a card retry (grace), and ends them on a refund', async () => {
    const sub = subscription();
    await apply(sub({}), { at: ago(5) });
    await apply(sub({ status: 'grace', current_period_end: ahead(16) }), {
      type: 'BILLING_ISSUE',
      at: ago(4),
    });
    expect(await isPaid(me())).toBe(true);
    await apply(sub({ status: 'active', current_period_end: ahead(30) }), {
      type: 'RENEWAL',
      at: ago(3),
    });
    expect((await rowsFor(me()))[0]!.status).toBe('active');

    await apply(sub({ status: 'refunded', price_minor: null }), { type: 'REFUND', at: ago(1) });
    expect(await isPaid(me())).toBe(false);
  });

  it('a row whose period has run out is not paid, whatever its status says', async () => {
    await apply(upsert({ status: 'active', current_period_end: ago(1).toISOString() }));
    expect(await isPaid(me())).toBe(false);
    expect(await myPlan(me())).toMatchObject({ plan: 'free' });
    await apply(upsert({ status: 'grace', current_period_end: ago(1).toISOString() }), {
      user: other(),
    });
    expect(await isPaid(other())).toBe(false);
  });

  it('refunded, expired and cancelled rows never count as paid', async () => {
    for (const status of ['refunded', 'expired', 'cancelled']) {
      await client.query(`DELETE FROM subscriptions WHERE profile_id = $1`, [me()]);
      await apply(upsert({ status, tier: 'pro' }));
      expect(await isPaid(me()), status).toBe(false);
    }
  });

  it('a Plus to Pro product change keeps one row, and Plus is Pro throughout', async () => {
    const sub = subscription({ tier: 'plus', price_minor: 4900 });
    await apply(sub({}), { at: ago(10) });
    expect(await myPlan(me())).toMatchObject({ plan: 'pro' });

    await apply(sub({ tier: 'pro', price_minor: null }), { type: 'PRODUCT_CHANGE', at: ago(5) });
    const [row] = await rowsFor(me());
    expect(await rowsFor(me())).toHaveLength(1);
    expect(row!.tier).toBe('pro');
    expect(await myPlan(me())).toMatchObject({ plan: 'pro' });
    // The earlier price is kept when a later event carries none.
    expect(row!.price_minor).toBe('4900');

    // A renewal that still names Plus is stored as Pro: nothing writes Plus.
    await apply(sub({ tier: 'pro' }), { type: 'PRODUCT_CHANGE', at: ago(4) });
    expect(await myPlan(me())).toMatchObject({ plan: 'pro' });
    await apply(sub({ tier: 'plus' }), { type: 'RENEWAL', at: ago(1) });
    expect(await myPlan(me())).toMatchObject({ plan: 'pro' });
    expect((await rowsFor(me()))[0]!.tier).toBe('pro');
  });

  it('holding Plus on one store and Pro on another is Pro; losing one leaves the other Pro', async () => {
    await apply(upsert({ tier: 'plus', store: 'play' }));
    const pro = subscription({ tier: 'pro', store: 'appstore' });
    await apply(pro({}));
    expect(await myPlan(me())).toMatchObject({ plan: 'pro' });
    await apply(pro({ status: 'expired' }), { type: 'EXPIRATION' });
    expect(await myPlan(me())).toMatchObject({ plan: 'pro' });
  });

  it('a lifetime row with no end date is paid and reported as lifetime', async () => {
    await apply(upsert({ period: 'lifetime', current_period_end: null }));
    expect(await isPaid(me())).toBe(true);
    expect(await myPlan(me())).toMatchObject({ source: 'lifetime' });
  });
});

describe('events out of order', () => {
  it('an older cancellation, billing issue or renewal cannot undo a newer expiry', async () => {
    const sub = subscription();
    await apply(sub({ status: 'expired' }), { type: 'EXPIRATION', at: ago(1) });
    for (const [type, status] of [
      ['CANCELLATION', 'active'],
      ['BILLING_ISSUE', 'grace'],
      ['RENEWAL', 'active'],
    ] as const) {
      expect(await apply(sub({ status }), { type, at: ago(2) }), type).toBe('stale');
    }
    expect((await rowsFor(me()))[0]!.status).toBe('expired');
    expect(await isPaid(me())).toBe(false);
  });

  it('a newer event still applies after a late older one was refused', async () => {
    const sub = subscription();
    await apply(sub({}), { at: ago(3) });
    expect(await apply(sub({ status: 'grace' }), { type: 'BILLING_ISSUE', at: ago(4) })).toBe(
      'stale',
    );
    expect(await apply(sub({ status: 'expired' }), { type: 'EXPIRATION', at: ago(1) })).toBe(
      'applied',
    );
    expect((await rowsFor(me()))[0]!.status).toBe('expired');
  });

  it('an event stamped at the same instant applies, so a same-millisecond batch is not lost', async () => {
    const sub = subscription();
    const at = ago(1);
    await apply(sub({}), { at });
    expect(await apply(sub({ status: 'grace' }), { type: 'BILLING_ISSUE', at })).toBe('applied');
  });

  it('a stale event is recorded, so its redelivery is a duplicate and not a second try', async () => {
    const sub = subscription();
    await apply(sub({}), { at: ago(1) });
    const id = randomUUID();
    expect(await apply(sub({ status: 'expired' }), { id, type: 'EXPIRATION', at: ago(2) })).toBe(
      'stale',
    );
    expect(await apply(sub({ status: 'expired' }), { id, type: 'EXPIRATION', at: ago(2) })).toBe(
      'duplicate',
    );
    const { rows } = await client.query(`SELECT outcome FROM revenuecat_events WHERE id = $1`, [
      id,
    ]);
    expect(rows[0].outcome).toBe('stale');
  });
});

describe('stores', () => {
  it.each(['play', 'appstore', 'test'])('a %s purchase unlocks Pro', async (store) => {
    await apply(upsert({ store, tier: 'pro' }));
    expect(await isPaid(me())).toBe(true);
    expect((await rowsFor(me()))[0]!.store).toBe(store);
  });

  it('refuses a store the table does not know, and the event is not recorded as applied', async () => {
    const id = randomUUID();
    await expect(apply(upsert({ store: 'stripe' }), { id })).rejects.toThrow(
      /subscriptions_store_known/,
    );
    // The whole call rolled back: the retry that RevenueCat sends starts clean.
    const { rows } = await client.query(`SELECT 1 FROM revenuecat_events WHERE id = $1`, [id]);
    expect(rows).toHaveLength(0);
  });

  it('refuses a tier or period the table does not know', async () => {
    await expect(apply(upsert({ tier: 'gold' }))).rejects.toThrow(/subscriptions_tier_known/);
    await expect(apply(upsert({ period: 'weekly' }))).rejects.toThrow(/subscriptions_period_known/);
  });

  it('two stores with the same user keep separate rows, keyed by transaction', async () => {
    await apply(upsert({ store: 'play', store_txn_id: 'GPA.shared-1' }));
    await apply(upsert({ store: 'appstore', store_txn_id: '2000000555' }));
    expect((await rowsFor(me())).map((r) => r.store).sort()).toEqual(['appstore', 'play']);
  });
});

describe('transfer edge cases', () => {
  it('a transfer to an id that is not a profile moves nothing', async () => {
    await apply(upsert({ store: 'appstore' }), { user: other() });
    expect(
      await apply({ kind: 'transfer', from: [other()], to: randomUUID() }, { type: 'TRANSFER' }),
    ).toBe('unknown_profile');
    expect(await rowsFor(other())).toHaveLength(1);
    expect(await apply({ kind: 'transfer', from: [other()], to: 'not-a-uuid' })).toBe(
      'unknown_profile',
    );
  });

  it('ignores anonymous ids in the from list and replaying a transfer changes nothing', async () => {
    await apply(upsert({ store: 'play' }), { user: other() });
    const id = randomUUID();
    const action = { kind: 'transfer', from: ['$RCAnonymousID:abc', other()], to: me() };
    expect(await apply(action, { id, type: 'TRANSFER' })).toBe('applied');
    expect(await apply(action, { id, type: 'TRANSFER' })).toBe('duplicate');
    expect(await rowsFor(me())).toHaveLength(1);
    expect(await rowsFor(other())).toHaveLength(0);
    expect(await isPaid(me())).toBe(true);
    expect(await isPaid(other())).toBe(false);
  });

  it('a transfer to the same profile leaves its rows alone', async () => {
    await apply(upsert({ store: 'play' }));
    expect(await apply({ kind: 'transfer', from: [me()], to: me() })).toBe('applied');
    expect(await rowsFor(me())).toHaveLength(1);
  });
});

describe('delivery', () => {
  it('the same event id arriving on two connections at once is applied exactly once', async () => {
    const second = await connect();
    try {
      const id = randomUUID();
      const action = upsert();
      const call = (c: Client) =>
        c
          .query(
            `SELECT waves_revenuecat_apply($1, 'INITIAL_PURCHASE', $2, now(), $3::jsonb) AS o`,
            [id, me(), JSON.stringify(action)],
          )
          .then((r) => r.rows[0].o as string);
      const outcomes = (await Promise.all([call(client), call(second)])).sort();
      expect(outcomes).toEqual(['applied', 'duplicate']);
      expect(await rowsFor(me())).toHaveLength(1);
    } finally {
      await second.end();
    }
  });

  it('refuses a call with no event id, so nothing is applied unrecorded', async () => {
    await expect(apply(upsert(), { id: '' })).rejects.toThrow(/needs an event id/);
    expect(await rowsFor(me())).toHaveLength(0);
  });

  it('applies an event with no timestamp, and a later timestamped one still wins', async () => {
    const sub = subscription();
    expect(
      await client
        .query(`SELECT waves_revenuecat_apply($1, 'RENEWAL', $2, NULL, $3::jsonb) AS o`, [
          randomUUID(),
          me(),
          JSON.stringify(sub({})),
        ])
        .then((r) => r.rows[0].o),
    ).toBe('applied');
    expect(await apply(sub({ status: 'expired' }), { type: 'EXPIRATION' })).toBe('applied');
  });
});
