/**
 * Every RevenueCat event type Waves handles, mapped to the `subscriptions` write
 * it should cause.
 */

import { describe, expect, it } from 'vitest';

import { mapEvent, priceMinor, storeFor, type RcEvent, type UpsertAction } from './logic.ts';

const ME = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const NOW = Date.parse('2026-10-07T12:00:00Z');
const DAY = 86_400_000;

function event(over: Partial<RcEvent> = {}): RcEvent {
  return {
    id: 'evt-1',
    type: 'INITIAL_PURCHASE',
    app_user_id: ME,
    product_id: 'waves_plus_monthly',
    entitlement_ids: ['plus'],
    purchased_at_ms: NOW,
    expiration_at_ms: NOW + 30 * DAY,
    event_timestamp_ms: NOW,
    store: 'PLAY_STORE',
    environment: 'PRODUCTION',
    transaction_id: 'GPA.1234-5678..1',
    original_transaction_id: 'GPA.1234-5678',
    price_in_purchased_currency: 49,
    currency: 'INR',
    country_code: 'in',
    ...over,
  };
}

function upsert(over: Partial<RcEvent> = {}): UpsertAction {
  const { action } = mapEvent(event(over));
  if (action.kind !== 'upsert') throw new Error(`expected upsert, got ${JSON.stringify(action)}`);
  return action;
}

describe('mapEvent', () => {
  it('INITIAL_PURCHASE of a retired Plus product writes an active Pro row keyed by the original transaction', () => {
    const mapped = mapEvent(event());
    expect(mapped).toMatchObject({
      eventId: 'evt-1',
      type: 'INITIAL_PURCHASE',
      appUserId: ME,
      eventAt: new Date(NOW).toISOString(),
    });
    expect(mapped.action).toEqual({
      kind: 'upsert',
      tier: 'pro',
      period: 'monthly',
      status: 'active',
      current_period_end: new Date(NOW + 30 * DAY).toISOString(),
      store: 'play',
      store_txn_id: 'GPA.1234-5678',
      price_minor: 4900,
      currency: 'INR',
      country_code: 'IN',
    });
  });

  it('reads Pro from the entitlement, else from the product id', () => {
    expect(upsert({ entitlement_ids: ['pro'], product_id: 'x' }).tier).toBe('pro');
    expect(upsert({ entitlement_ids: ['plus', 'pro'] }).tier).toBe('pro');
    expect(upsert({ entitlement_ids: null, product_id: 'waves_pro_monthly:base' }).tier).toBe(
      'pro',
    );
    expect(mapEvent(event({ entitlement_ids: [], product_id: 'other_app' })).action.kind).toBe(
      'ignore',
    );
  });

  it('RENEWAL and UNCANCELLATION keep the row active with the new end', () => {
    const end = NOW + 60 * DAY;
    expect(upsert({ type: 'RENEWAL', expiration_at_ms: end })).toMatchObject({
      status: 'active',
      current_period_end: new Date(end).toISOString(),
      store_txn_id: 'GPA.1234-5678',
    });
    expect(upsert({ type: 'UNCANCELLATION' }).status).toBe('active');
  });

  it('CANCELLATION stays active until expiry; a support cancellation is a refund', () => {
    expect(upsert({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' })).toMatchObject({
      status: 'active',
      current_period_end: new Date(NOW + 30 * DAY).toISOString(),
    });
    expect(upsert({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' })).toMatchObject({
      status: 'refunded',
      price_minor: null,
    });
  });

  it('BILLING_ISSUE is grace until the grace period ends', () => {
    const grace = NOW + 16 * DAY;
    expect(
      upsert({
        type: 'BILLING_ISSUE',
        grace_period_expiration_at_ms: grace,
        expiration_at_ms: NOW,
      }),
    ).toMatchObject({ status: 'grace', current_period_end: new Date(grace).toISOString() });
    expect(upsert({ type: 'BILLING_ISSUE', grace_period_expiration_at_ms: null }).status).toBe(
      'grace',
    );
  });

  it('EXPIRATION expires, even without an expiration date on the event', () => {
    expect(upsert({ type: 'EXPIRATION' }).status).toBe('expired');
    expect(upsert({ type: 'EXPIRATION', expiration_at_ms: null })).toMatchObject({
      status: 'expired',
      period: 'monthly',
      current_period_end: new Date(NOW).toISOString(),
    });
  });

  it('REFUND is refunded and records no price', () => {
    expect(upsert({ type: 'REFUND', price_in_purchased_currency: -49 })).toMatchObject({
      status: 'refunded',
      price_minor: null,
      currency: null,
    });
  });

  it('PRODUCT_CHANGE applies an upgrade now and leaves a downgrade for the renewal', () => {
    expect(upsert({ type: 'PRODUCT_CHANGE', new_product_id: 'waves_pro_monthly' })).toMatchObject({
      tier: 'pro',
      status: 'active',
    });
    expect(
      upsert({
        type: 'PRODUCT_CHANGE',
        product_id: 'waves_pro_monthly',
        entitlement_ids: ['pro'],
        new_product_id: 'waves_plus_monthly',
      }).tier,
    ).toBe('pro');
  });

  it('TRANSFER moves from the old ids to the new one', () => {
    expect(
      mapEvent(
        event({
          type: 'TRANSFER',
          app_user_id: undefined,
          transferred_from: ['$RCAnonymousID:abc', 'old'],
          transferred_to: [ME],
        }),
      ),
    ).toMatchObject({
      appUserId: ME,
      action: { kind: 'transfer', from: ['$RCAnonymousID:abc', 'old'], to: ME },
    });
    expect(mapEvent(event({ type: 'TRANSFER', transferred_to: [] })).action.kind).toBe('ignore');
  });

  it('ignores TEST, unknown types, unsupported stores and missing transactions', () => {
    expect(mapEvent(event({ type: 'TEST' })).action.kind).toBe('ignore');
    expect(mapEvent(event({ type: 'SUBSCRIPTION_PAUSED' })).action.kind).toBe('ignore');
    expect(mapEvent(event({ store: 'STRIPE' })).action.kind).toBe('ignore');
    expect(
      mapEvent(event({ transaction_id: null, original_transaction_id: null })).action.kind,
    ).toBe('ignore');
  });

  it('drops sandbox events only when told to', () => {
    expect(mapEvent(event({ environment: 'SANDBOX' })).action.kind).toBe('upsert');
    expect(
      mapEvent(event({ environment: 'SANDBOX' }), { ignoreSandbox: true }).action,
    ).toMatchObject({ kind: 'ignore', reason: 'sandbox' });
  });

  it('grants a store-outage stand-in until it expires, on a row of its own', () => {
    const NOW_ISO = new Date(NOW + DAY).toISOString();
    expect(
      mapEvent(
        event({
          id: 'evt-temp-1',
          type: 'TEMPORARY_ENTITLEMENT_GRANT',
          entitlement_ids: ['pro'],
          product_id: null,
          transaction_id: null,
          original_transaction_id: null,
          expiration_at_ms: NOW + DAY,
        }),
      ).action,
    ).toMatchObject({
      kind: 'upsert',
      tier: 'pro',
      status: 'active',
      store_txn_id: 'temp:evt-temp-1',
      current_period_end: NOW_ISO,
    });
  });

  it('writes Test Store purchases, and drops them as sandbox when told to', () => {
    expect(mapEvent(event({ store: 'TEST_STORE' })).action).toMatchObject({
      kind: 'upsert',
      store: 'test',
    });
    expect(
      mapEvent(event({ store: 'TEST_STORE', environment: 'PRODUCTION' }), { ignoreSandbox: true })
        .action,
    ).toMatchObject({ kind: 'ignore', reason: 'sandbox' });
  });

  it('works out the period from the dates when the product id does not say', () => {
    expect(upsert({ product_id: 'waves_plus', expiration_at_ms: NOW + 365 * DAY }).period).toBe(
      'yearly',
    );
    expect(upsert({ product_id: 'waves_plus', expiration_at_ms: NOW + 31 * DAY }).period).toBe(
      'monthly',
    );
    expect(upsert({ product_id: 'waves_pro_yearly' }).period).toBe('yearly');
    expect(upsert({ product_id: 'waves_plus', expiration_at_ms: null })).toMatchObject({
      period: 'lifetime',
      current_period_end: null,
    });
  });
});

describe('helpers', () => {
  it('maps stores', () => {
    expect(storeFor('APP_STORE')).toBe('appstore');
    expect(storeFor('MAC_APP_STORE')).toBe('appstore');
    expect(storeFor('PLAY_STORE')).toBe('play');
    expect(storeFor('PROMOTIONAL')).toBe('promo');
    expect(storeFor('TEST_STORE')).toBe('test');
    expect(storeFor('AMAZON')).toBeNull();
  });

  it('prices in minor units per currency', () => {
    expect(priceMinor(event({ price_in_purchased_currency: 0.99, currency: 'USD' }))).toEqual({
      minor: 99,
      currency: 'USD',
    });
    expect(priceMinor(event({ price_in_purchased_currency: 500, currency: 'JPY' }))).toEqual({
      minor: 500,
      currency: 'JPY',
    });
    expect(priceMinor(event({ price_in_purchased_currency: 0 }))).toBeNull();
    expect(priceMinor(event({ currency: 'rupees' }))).toBeNull();
  });
});

describe('stores and product ids', () => {
  it.each([
    ['APP_STORE', 'appstore', '2000000100'],
    ['PLAY_STORE', 'play', 'GPA.1234-5678'],
    ['TEST_STORE', 'test', 'test-txn-1'],
    ['play_store', 'play', 'GPA.1234-5678'],
  ] as const)('%s writes a %s row keyed by the original transaction', (raw, store, txn) => {
    expect(
      upsert({ store: raw, original_transaction_id: txn, transaction_id: `${txn}.1` }),
    ).toMatchObject({
      store,
      store_txn_id: txn,
    });
  });

  it('falls back to the transaction id when there is no original one', () => {
    expect(
      upsert({ original_transaction_id: null, transaction_id: 'GPA.only-this' }).store_txn_id,
    ).toBe('GPA.only-this');
  });

  it.each([
    // Google Play reports <productId>:<basePlanId>
    // Plus is retired: its products still map, to Pro
    ['waves_plus_monthly:monthly', 'pro', 'monthly'],
    ['waves_plus_yearly:yearly', 'pro', 'yearly'],
    ['waves_pro_monthly:monthly', 'pro', 'monthly'],
    ['waves_pro_yearly:yearly', 'pro', 'yearly'],
    // App Store and Test Store use the plain id
    ['waves_plus_monthly', 'pro', 'monthly'],
    ['waves_plus_yearly', 'pro', 'yearly'],
    ['waves_pro_monthly', 'pro', 'monthly'],
    ['waves_pro_yearly', 'pro', 'yearly'],
  ] as const)('reads %s as %s %s with no entitlement on the event', (product_id, tier, period) => {
    expect(upsert({ product_id, entitlement_ids: null })).toMatchObject({ tier, period });
  });

  it('prefers the entitlement RevenueCat attached over the product id', () => {
    expect(upsert({ product_id: 'waves_plus_monthly', entitlement_ids: ['pro'] }).tier).toBe('pro');
    expect(upsert({ product_id: 'x', entitlement_ids: null, entitlement_id: 'plus' }).tier).toBe(
      'pro',
    );
  });

  it('ignores a product that is neither Plus nor Pro, naming it', () => {
    for (const product_id of ['some_other_app', 'waves_promo', 'monthly', 'lifetime', '', null]) {
      const { action } = mapEvent(event({ product_id, entitlement_ids: [] }));
      expect(action, String(product_id)).toMatchObject({ kind: 'ignore' });
    }
    expect(
      mapEvent(event({ product_id: 'sample_pack', entitlement_ids: ['waves_pro'] })).action,
    ).toMatchObject({ kind: 'ignore', reason: expect.stringContaining('sample_pack') });
  });

  it('ignores a store Waves does not sell through, and a missing one', () => {
    for (const store of ['AMAZON', 'STRIPE', 'RC_BILLING', '', null]) {
      expect(mapEvent(event({ store })).action, String(store)).toMatchObject({ kind: 'ignore' });
    }
  });
});

describe('product changes', () => {
  const change = (from: string, to: string, over: Partial<RcEvent> = {}) =>
    upsert({
      type: 'PRODUCT_CHANGE',
      product_id: from,
      new_product_id: to,
      entitlement_ids: [from.includes('pro') ? 'pro' : 'plus'],
      ...over,
    });

  it('Plus to Pro: the Pro tier and the new product’s period apply now', () => {
    expect(change('waves_plus_monthly', 'waves_pro_monthly')).toMatchObject({
      tier: 'pro',
      status: 'active',
      period: 'monthly',
    });
    expect(change('waves_plus_monthly', 'waves_pro_yearly')).toMatchObject({
      tier: 'pro',
      period: 'yearly',
    });
    expect(change('waves_plus_monthly:monthly', 'waves_pro_monthly:monthly').tier).toBe('pro');
  });

  it('Pro to Plus: the person stays Pro until the renewal brings the new product', () => {
    expect(change('waves_pro_monthly', 'waves_plus_monthly')).toMatchObject({
      tier: 'pro',
      period: 'monthly',
    });
    expect(change('waves_pro_yearly', 'waves_plus_monthly')).toMatchObject({
      tier: 'pro',
      period: 'yearly',
    });
    // ...and the renewal that follows is still a Pro row on the same transaction.
    expect(
      upsert({ type: 'RENEWAL', product_id: 'waves_plus_monthly', entitlement_ids: ['plus'] }),
    ).toMatchObject({ tier: 'pro', store_txn_id: 'GPA.1234-5678' });
  });

  it('same tier, different period: stays that tier, takes the old product’s period', () => {
    expect(change('waves_plus_monthly', 'waves_plus_yearly')).toMatchObject({
      tier: 'pro',
      period: 'monthly',
    });
  });

  it('a change to something unknown, or with no new product, changes nothing', () => {
    expect(change('waves_plus_monthly', 'something_else')).toMatchObject({ tier: 'pro' });
    expect(change('waves_plus_monthly', '', { new_product_id: null })).toMatchObject({
      tier: 'pro',
    });
  });
});

describe('one transaction, every event', () => {
  const TYPES = [
    'INITIAL_PURCHASE',
    'RENEWAL',
    'PRODUCT_CHANGE',
    'CANCELLATION',
    'UNCANCELLATION',
    'BILLING_ISSUE',
    'EXPIRATION',
    'REFUND',
  ];

  it('all land on the same row, so each updates what the purchase created', () => {
    const keys = TYPES.map((type) => upsert({ type }).store_txn_id);
    expect(new Set(keys)).toEqual(new Set(['GPA.1234-5678']));
  });

  it.each([
    ['INITIAL_PURCHASE', 'active'],
    ['RENEWAL', 'active'],
    ['PRODUCT_CHANGE', 'active'],
    ['CANCELLATION', 'active'],
    ['UNCANCELLATION', 'active'],
    ['BILLING_ISSUE', 'grace'],
    ['EXPIRATION', 'expired'],
    ['REFUND', 'refunded'],
  ])('%s is %s', (type, status) => {
    expect(upsert({ type }).status).toBe(status);
  });

  it('matches event types without regard to case', () => {
    expect(upsert({ type: 'renewal' }).status).toBe('active');
    expect(mapEvent(event({ type: 'expiration' })).type).toBe('EXPIRATION');
    expect(upsert({ type: 'CANCELLATION', cancel_reason: 'customer_support' }).status).toBe(
      'refunded',
    );
  });

  it('hands every event its own timestamp, for the database’s ordering guard', () => {
    const older = mapEvent(event({ type: 'RENEWAL', event_timestamp_ms: NOW - DAY }));
    const newer = mapEvent(event({ type: 'EXPIRATION', event_timestamp_ms: NOW }));
    expect(Date.parse(older.eventAt!)).toBeLessThan(Date.parse(newer.eventAt!));
    expect(mapEvent(event({ event_timestamp_ms: null })).eventAt).toBeNull();
    expect(mapEvent(event({ event_timestamp_ms: 0 })).eventAt).toBeNull();
  });
});

describe('SUBSCRIPTION_PAUSED and other types Waves does not act on', () => {
  it.each([
    'SUBSCRIPTION_PAUSED',
    'NON_RENEWING_PURCHASE',
    'INVOICE_ISSUANCE',
    'VIRTUAL_CURRENCY_TRANSACTION',
    'TEST',
  ])('%s is recorded and writes nothing', (type) => {
    const mapped = mapEvent(event({ type }));
    expect(mapped.action).toMatchObject({ kind: 'ignore', reason: `unhandled type ${type}` });
    expect(mapped.eventId).toBe('evt-1');
  });

  it('ignores an event with no type at all', () => {
    expect(mapEvent(event({ type: undefined })).action).toMatchObject({
      kind: 'ignore',
      reason: 'unhandled type (none)',
    });
  });
});

describe('sandbox and the Test Store', () => {
  it('lets sandbox events through by default, and drops them under ignoreSandbox', () => {
    for (const environment of ['SANDBOX', 'sandbox']) {
      expect(mapEvent(event({ environment })).action.kind).toBe('upsert');
      expect(mapEvent(event({ environment }), { ignoreSandbox: true }).action).toMatchObject({
        kind: 'ignore',
        reason: 'sandbox',
      });
    }
    expect(mapEvent(event({ environment: 'SANDBOX' }), { ignoreSandbox: false }).action.kind).toBe(
      'upsert',
    );
  });

  it('never drops production purchases on a real store', () => {
    for (const store of ['APP_STORE', 'PLAY_STORE']) {
      expect(
        mapEvent(event({ store, environment: 'PRODUCTION' }), { ignoreSandbox: true }).action.kind,
      ).toBe('upsert');
    }
  });

  it('drops a Test Store event whatever its environment says', () => {
    for (const environment of ['PRODUCTION', 'SANDBOX', null]) {
      expect(
        mapEvent(event({ store: 'TEST_STORE', environment }), { ignoreSandbox: true }).action,
      ).toMatchObject({ kind: 'ignore', reason: 'sandbox' });
    }
  });

  it('drops a sandbox TRANSFER too, rather than moving real purchases for a test', () => {
    expect(
      mapEvent(
        event({
          type: 'TRANSFER',
          environment: 'SANDBOX',
          transferred_to: [ME],
          transferred_from: ['x'],
        }),
        { ignoreSandbox: true },
      ).action,
    ).toMatchObject({ kind: 'ignore', reason: 'sandbox' });
  });

  it('checks the sandbox before anything else, so a TEST event still counts as ignored', () => {
    expect(
      mapEvent(event({ type: 'TEST', environment: 'SANDBOX' }), { ignoreSandbox: true }).action,
    ).toMatchObject({ reason: 'sandbox' });
  });
});
