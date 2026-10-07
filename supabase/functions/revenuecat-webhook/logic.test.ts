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
  it('INITIAL_PURCHASE writes an active Plus row keyed by the original transaction', () => {
    const mapped = mapEvent(event());
    expect(mapped).toMatchObject({
      eventId: 'evt-1',
      type: 'INITIAL_PURCHASE',
      appUserId: ME,
      eventAt: new Date(NOW).toISOString(),
    });
    expect(mapped.action).toEqual({
      kind: 'upsert',
      tier: 'plus',
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
