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
