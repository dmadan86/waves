/**
 * The webhook end to end with a stubbed database: the secret check, the event
 * handed to `waves_revenuecat_apply`, and idempotency on the event id.
 */

import { describe, expect, it, vi } from 'vitest';

import { authorized, handleRevenueCatWebhook, safeEqual, type Deps } from './handler.ts';

const SECRET = 'rc-webhook-secret-123';
const ME = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

function request(body: unknown, auth: string | null = SECRET, method = 'POST'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== null) headers.Authorization = auth;
  return new Request('https://x.supabase.co/functions/v1/revenuecat-webhook', {
    method,
    headers,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

/** A fake database that dedupes on the event id the way the SQL function does. */
function makeDeps(env: Record<string, string | undefined> = { REVENUECAT_WEBHOOK_SECRET: SECRET }) {
  const seen = new Set<string>();
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    const id = args.p_event_id as string;
    if (seen.has(id)) return { data: 'duplicate', error: null };
    seen.add(id);
    const action = args.p_action as { kind: string };
    return { data: action.kind === 'ignore' ? 'ignored' : 'applied', error: null };
  });
  const deps: Deps = { env: (name) => env[name], service: { rpc } };
  return { deps, rpc };
}

const EVENT_TYPES = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'UNCANCELLATION',
  'REFUND',
] as const;

function rcEvent(type: string, over: Record<string, unknown> = {}) {
  return {
    api_version: '1.0',
    event: {
      id: `evt-${type}`,
      type,
      app_user_id: ME,
      product_id: 'waves_pro_monthly',
      entitlement_ids: ['pro'],
      new_product_id: type === 'PRODUCT_CHANGE' ? 'waves_pro_yearly' : undefined,
      purchased_at_ms: 1_790_000_000_000,
      expiration_at_ms: 1_792_600_000_000,
      event_timestamp_ms: 1_790_000_000_000,
      store: 'APP_STORE',
      environment: 'PRODUCTION',
      transaction_id: '2000000123',
      original_transaction_id: '2000000100',
      price_in_purchased_currency: 99,
      currency: 'INR',
      ...over,
    },
  };
}

describe('the secret', () => {
  it('compares in constant time and accepts the bare or Bearer form', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(authorized(SECRET, SECRET)).toBe(true);
    expect(authorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(authorized('Bearer nope', SECRET)).toBe(false);
    expect(authorized(null, SECRET)).toBe(false);
  });

  it('refuses a missing or wrong Authorization header before touching the database', async () => {
    const { deps, rpc } = makeDeps();
    await expect(
      handleRevenueCatWebhook(request(rcEvent('INITIAL_PURCHASE'), null), deps),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      handleRevenueCatWebhook(request(rcEvent('INITIAL_PURCHASE'), 'wrong'), deps),
    ).rejects.toMatchObject({ status: 401 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses everything while the secret is not configured', async () => {
    const { deps, rpc } = makeDeps({});
    await expect(
      handleRevenueCatWebhook(request(rcEvent('INITIAL_PURCHASE')), deps),
    ).rejects.toMatchObject({ status: 500, code: 'MISCONFIGURED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a non-POST and a body that is not an event', async () => {
    const { deps } = makeDeps();
    await expect(handleRevenueCatWebhook(request(null, SECRET, 'GET'), deps)).rejects.toMatchObject(
      { status: 405 },
    );
    await expect(handleRevenueCatWebhook(request('{not json'), deps)).rejects.toMatchObject({
      status: 400,
    });
    await expect(handleRevenueCatWebhook(request({ event: {} }), deps)).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('each event type', () => {
  it.each(EVENT_TYPES)('%s is handed to waves_revenuecat_apply as an upsert', async (type) => {
    const { deps, rpc } = makeDeps();
    const response = await handleRevenueCatWebhook(request(rcEvent(type)), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: 'applied' });
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe('waves_revenuecat_apply');
    expect(args).toMatchObject({
      p_event_id: `evt-${type}`,
      p_type: type,
      p_app_user_id: ME,
      p_action: { kind: 'upsert', tier: 'pro', store: 'appstore', store_txn_id: '2000000100' },
    });
    const expected =
      type === 'EXPIRATION'
        ? 'expired'
        : type === 'BILLING_ISSUE'
          ? 'grace'
          : type === 'REFUND'
            ? 'refunded'
            : 'active';
    expect((args as { p_action: { status: string } }).p_action.status).toBe(expected);
  });

  it('TRANSFER is handed over as a transfer to the new id', async () => {
    const { deps, rpc } = makeDeps();
    const body = rcEvent('TRANSFER', {
      app_user_id: undefined,
      transferred_from: ['old-id'],
      transferred_to: [ME],
    });
    const response = await handleRevenueCatWebhook(request(body), deps);
    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_type: 'TRANSFER',
      p_app_user_id: ME,
      p_action: { kind: 'transfer', from: ['old-id'], to: ME },
    });
  });

  it('acknowledges a TEST event without writing a subscription', async () => {
    const { deps, rpc } = makeDeps();
    const response = await handleRevenueCatWebhook(request(rcEvent('TEST')), deps);
    expect(await response.json()).toEqual({ ok: true, outcome: 'ignored' });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_action: { kind: 'ignore' } });
  });
});

describe('idempotency', () => {
  it('a replayed event id is a 200 duplicate, not a second write', async () => {
    const { deps } = makeDeps();
    const first = await handleRevenueCatWebhook(request(rcEvent('RENEWAL')), deps);
    const again = await handleRevenueCatWebhook(request(rcEvent('RENEWAL')), deps);
    expect(await first.json()).toEqual({ ok: true, outcome: 'applied' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, outcome: 'duplicate' });
  });

  it('answers 5xx when the write fails, so RevenueCat retries', async () => {
    const deps: Deps = {
      env: () => SECRET,
      service: { rpc: async () => ({ data: null, error: { message: 'boom' } }) },
    };
    await expect(
      handleRevenueCatWebhook(request(rcEvent('INITIAL_PURCHASE')), deps),
    ).rejects.toThrow(/boom/);
  });

  it('an unknown profile is acknowledged, not retried', async () => {
    const deps: Deps = {
      env: () => SECRET,
      service: { rpc: async () => ({ data: 'unknown_profile', error: null }) },
    };
    const response = await handleRevenueCatWebhook(
      request(rcEvent('INITIAL_PURCHASE', { app_user_id: '$RCAnonymousID:x' })),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: 'unknown_profile' });
  });
});

describe('the Authorization header, more closely', () => {
  it.each([
    ['a Bearer prefix in any case', 'bearer rc-webhook-secret-123', 200],
    ['surrounding whitespace', `  ${SECRET}  `, 200],
    ['a different scheme', `Basic ${SECRET}`, 401],
    ['the secret with something appended', `${SECRET}x`, 401],
    ['a prefix of the secret', SECRET.slice(0, -1), 401],
    ['the right secret in the wrong case', SECRET.toUpperCase(), 401],
    ['an empty header', '', 401],
    ['Bearer with nothing after it', 'Bearer ', 401],
  ])('%s', async (_name, header, status) => {
    const { deps, rpc } = makeDeps();
    const run = handleRevenueCatWebhook(request(rcEvent('RENEWAL'), header), deps);
    if (status === 200) {
      expect((await run).status).toBe(200);
      expect(rpc).toHaveBeenCalledTimes(1);
    } else {
      await expect(run).rejects.toMatchObject({ status: 401, code: 'NOT_AUTHORIZED' });
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it('answers 401 before it looks at the body, so a bad caller learns nothing about the format', async () => {
    const { deps, rpc } = makeDeps();
    await expect(
      handleRevenueCatWebhook(request('{not json', 'wrong'), deps),
    ).rejects.toMatchObject({ status: 401 });
    await expect(handleRevenueCatWebhook(request({}, null), deps)).rejects.toMatchObject({
      status: 401,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a missing or wrong header for every event type, TEST included', async () => {
    const { deps, rpc } = makeDeps();
    for (const type of [...EVENT_TYPES, 'TEST', 'TRANSFER', 'SUBSCRIPTION_PAUSED']) {
      await expect(
        handleRevenueCatWebhook(request(rcEvent(type), 'nope'), deps),
      ).rejects.toMatchObject({ status: 401 });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('product changes and the rest of the lifecycle', () => {
  const sent = async (type: string, over: Record<string, unknown> = {}) => {
    const { deps, rpc } = makeDeps();
    const response = await handleRevenueCatWebhook(request(rcEvent(type, over)), deps);
    return { response, args: rpc.mock.calls[0]![1] as { p_action: Record<string, unknown> } };
  };

  it('PRODUCT_CHANGE from Plus to Pro writes the Pro tier now', async () => {
    const { args } = await sent('PRODUCT_CHANGE', {
      product_id: 'waves_plus_monthly',
      entitlement_ids: ['plus'],
      new_product_id: 'waves_pro_monthly',
    });
    expect(args.p_action).toMatchObject({ kind: 'upsert', tier: 'pro', status: 'active' });
  });

  it('PRODUCT_CHANGE from Pro to Plus keeps Pro until the renewal', async () => {
    const { args } = await sent('PRODUCT_CHANGE', {
      product_id: 'waves_pro_monthly',
      entitlement_ids: ['pro'],
      new_product_id: 'waves_plus_monthly',
    });
    expect(args.p_action).toMatchObject({ kind: 'upsert', tier: 'pro', status: 'active' });
  });

  it('CANCELLATION stays active until the period ends; UNCANCELLATION reverses it', async () => {
    const cancel = await sent('CANCELLATION', { cancel_reason: 'UNSUBSCRIBE' });
    expect(cancel.args.p_action).toMatchObject({
      status: 'active',
      current_period_end: new Date(1_792_600_000_000).toISOString(),
    });
    const back = await sent('UNCANCELLATION');
    expect(back.args.p_action).toMatchObject({ status: 'active' });
  });

  it('SUBSCRIPTION_PAUSED is acknowledged and recorded but writes nothing', async () => {
    const { response, args } = await sent('SUBSCRIPTION_PAUSED');
    expect(await response.json()).toEqual({ ok: true, outcome: 'ignored' });
    expect(args.p_action).toMatchObject({ kind: 'ignore' });
  });

  it('a product that is not Plus or Pro is acknowledged and recorded, not retried', async () => {
    const { response, args } = await sent('INITIAL_PURCHASE', {
      product_id: 'monthly',
      entitlement_ids: [],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: 'ignored' });
    expect(args.p_action).toMatchObject({ kind: 'ignore' });
  });

  it('an unsupported store is acknowledged and recorded', async () => {
    const { response, args } = await sent('INITIAL_PURCHASE', { store: 'STRIPE' });
    expect(await response.json()).toEqual({ ok: true, outcome: 'ignored' });
    expect(args.p_action).toMatchObject({ kind: 'ignore' });
  });
});

describe('each store', () => {
  it.each([
    ['APP_STORE', 'appstore'],
    ['PLAY_STORE', 'play'],
    ['TEST_STORE', 'test'],
  ])('%s is written as %s', async (store, expected) => {
    const { deps, rpc } = makeDeps();
    const response = await handleRevenueCatWebhook(
      request(rcEvent('INITIAL_PURCHASE', { store })),
      deps,
    );
    expect(await response.json()).toEqual({ ok: true, outcome: 'applied' });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_action: { kind: 'upsert', store: expected } });
  });
});

describe('REVENUECAT_IGNORE_SANDBOX', () => {
  const withSetting = (value: string | undefined) =>
    makeDeps({ REVENUECAT_WEBHOOK_SECRET: SECRET, REVENUECAT_IGNORE_SANDBOX: value });
  const run = async (value: string | undefined, over: Record<string, unknown>) => {
    const { deps, rpc } = withSetting(value);
    const response = await handleRevenueCatWebhook(
      request(rcEvent('INITIAL_PURCHASE', over)),
      deps,
    );
    return { outcome: (await response.json()).outcome as string, rpc };
  };

  it('on: sandbox and Test Store events are acknowledged but not written', async () => {
    for (const over of [
      { environment: 'SANDBOX' },
      { store: 'TEST_STORE', environment: 'PRODUCTION' },
      { store: 'TEST_STORE', environment: 'SANDBOX' },
    ]) {
      const { outcome, rpc } = await run('true', over);
      expect(outcome).toBe('ignored');
      expect(rpc.mock.calls[0]![1]).toMatchObject({
        p_action: { kind: 'ignore', reason: 'sandbox' },
      });
    }
  });

  it('on: a production purchase on a real store is still written', async () => {
    expect((await run('true', { environment: 'PRODUCTION' })).outcome).toBe('applied');
  });

  it.each([undefined, 'false', '', '1', 'TRUE'])(
    '%j: sandbox events are written',
    async (value) => {
      expect((await run(value, { environment: 'SANDBOX' })).outcome).toBe('applied');
      expect((await run(value, { store: 'TEST_STORE' })).outcome).toBe('applied');
    },
  );
});

describe('the event id', () => {
  it('is trimmed before it is used, so a padded id is stored without the padding', async () => {
    const { deps, rpc } = makeDeps();
    await handleRevenueCatWebhook(request(rcEvent('RENEWAL', { id: '  evt-padded  ' })), deps);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_event_id: 'evt-padded' });
  });
});

describe('ordering and delivery', () => {
  /** A fake database that applies the SQL's rule: an older event never overwrites a newer one. */
  function orderedDb() {
    const seen = new Set<string>();
    const rows = new Map<string, { at: number; status: string }>();
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      const id = args.p_event_id as string;
      if (seen.has(id)) return { data: 'duplicate', error: null };
      seen.add(id);
      const action = args.p_action as { kind: string; store_txn_id?: string; status?: string };
      if (action.kind !== 'upsert') return { data: 'ignored', error: null };
      const at = Date.parse(args.p_event_at as string);
      const row = rows.get(action.store_txn_id!);
      if (row && row.at > at) return { data: 'stale', error: null };
      rows.set(action.store_txn_id!, { at, status: action.status! });
      return { data: 'applied', error: null };
    });
    const deps: Deps = { env: (n) => ({ REVENUECAT_WEBHOOK_SECRET: SECRET })[n], service: { rpc } };
    return { deps, rpc, rows };
  }

  it('hands the database each event’s own timestamp as p_event_at', async () => {
    const { deps, rpc } = makeDeps();
    await handleRevenueCatWebhook(
      request(rcEvent('RENEWAL', { event_timestamp_ms: 1_791_000_000_000 })),
      deps,
    );
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_event_at: new Date(1_791_000_000_000).toISOString(),
    });
  });

  it('sends a null p_event_at for an event with no timestamp, rather than inventing one', async () => {
    const { deps, rpc } = makeDeps();
    await handleRevenueCatWebhook(
      request(rcEvent('RENEWAL', { event_timestamp_ms: undefined })),
      deps,
    );
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_event_at: null });
  });

  it('an older event delivered after a newer one is acknowledged as stale and changes nothing', async () => {
    const { deps, rows } = orderedDb();
    const t = 1_791_000_000_000;
    const expiry = rcEvent('EXPIRATION', { id: 'evt-late-1', event_timestamp_ms: t });
    const renewal = rcEvent('RENEWAL', { id: 'evt-late-0', event_timestamp_ms: t - 86_400_000 });
    const first = await handleRevenueCatWebhook(request(expiry), deps);
    const second = await handleRevenueCatWebhook(request(renewal), deps);
    expect(await first.json()).toEqual({ ok: true, outcome: 'applied' });
    // 200, so RevenueCat stops retrying something that can never apply.
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, outcome: 'stale' });
    expect([...rows.values()]).toEqual([{ at: t, status: 'expired' }]);
  });

  it('delivered in order, each event applies and the last one stands', async () => {
    const { deps, rows } = orderedDb();
    const t = 1_791_000_000_000;
    const steps = [
      ['INITIAL_PURCHASE', 0],
      ['BILLING_ISSUE', 1],
      ['RENEWAL', 2],
      ['CANCELLATION', 3],
      ['EXPIRATION', 4],
    ] as const;
    for (const [type, day] of steps) {
      const response = await handleRevenueCatWebhook(
        request(rcEvent(type, { id: `evt-${type}`, event_timestamp_ms: t + day * 86_400_000 })),
        deps,
      );
      expect((await response.json()).outcome).toBe('applied');
    }
    expect([...rows.values()]).toEqual([{ at: t + 4 * 86_400_000, status: 'expired' }]);
  });

  it('the same event delivered twice at once is one write', async () => {
    const { deps, rpc } = makeDeps();
    const [a, b] = await Promise.all([
      handleRevenueCatWebhook(request(rcEvent('RENEWAL')), deps),
      handleRevenueCatWebhook(request(rcEvent('RENEWAL')), deps),
    ]);
    const outcomes = [(await a.json()).outcome, (await b.json()).outcome].sort();
    expect(outcomes).toEqual(['applied', 'duplicate']);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('a replay is a duplicate whatever the second body says', async () => {
    const { deps } = makeDeps();
    await handleRevenueCatWebhook(request(rcEvent('INITIAL_PURCHASE', { id: 'same' })), deps);
    const again = await handleRevenueCatWebhook(
      request(rcEvent('EXPIRATION', { id: 'same' })),
      deps,
    );
    expect(await again.json()).toEqual({ ok: true, outcome: 'duplicate' });
  });

  it('answers 400 for a body that is not an event, so RevenueCat sees the mistake', async () => {
    const { deps, rpc } = makeDeps();
    for (const body of [
      { event: 'nope' },
      { event: { id: 7 } },
      { event: { id: '' } },
      { event: { id: '   ' } },
      { event: { id: '\t\n' } },
      null,
      [],
    ]) {
      await expect(handleRevenueCatWebhook(request(body), deps)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
