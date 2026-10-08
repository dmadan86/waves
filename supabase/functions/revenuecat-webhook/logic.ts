/**
 * What a RevenueCat webhook event means for `subscriptions`. Pure: no I/O, so
 * every event type is pinned by a unit test (logic.test.ts).
 *
 * One row per store subscription, keyed by the store's original transaction id,
 * so a renewal, cancellation or expiry updates the row its purchase created
 * rather than adding another. The database applies the result atomically with
 * the event-id dedupe (`waves_revenuecat_apply`).
 *
 * Event → row:
 *   INITIAL_PURCHASE, RENEWAL, UNCANCELLATION,
 *   SUBSCRIPTION_EXTENDED, REFUND_REVERSED  → active until expiration
 *   PRODUCT_CHANGE                          → active; the new tier only when it is
 *                                             an upgrade (stores apply upgrades now,
 *                                             downgrades at the next renewal, which
 *                                             then arrives as a RENEWAL of the new product)
 *   CANCELLATION                            → stays active until expiration (it only
 *                                             stops the renewal); refunded when the
 *                                             reason is CUSTOMER_SUPPORT (a store refund)
 *   BILLING_ISSUE                           → grace until the grace period ends
 *   EXPIRATION                              → expired
 *   REFUND                                  → refunded
 *   TRANSFER                                → store rows move to the new profile
 *   TEST and anything else                  → recorded, nothing written
 */

import {
  baseProductId,
  isCurrencyCode,
  minorUnitExponent,
  periodFromProductId,
  PlanTier,
  tierFromEntitlementIds,
  tierFromProductId,
  tierRank,
  type CurrencyCode,
} from '../_shared/core.js';

/** The fields of a RevenueCat webhook `event` Waves reads. All optional: trust nothing. */
export interface RcEvent {
  id?: string;
  type?: string;
  app_user_id?: string | null;
  original_app_user_id?: string | null;
  product_id?: string | null;
  new_product_id?: string | null;
  entitlement_ids?: string[] | null;
  entitlement_id?: string | null;
  purchased_at_ms?: number | null;
  expiration_at_ms?: number | null;
  grace_period_expiration_at_ms?: number | null;
  event_timestamp_ms?: number | null;
  store?: string | null;
  environment?: string | null;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
  price_in_purchased_currency?: number | null;
  currency?: string | null;
  country_code?: string | null;
  cancel_reason?: string | null;
  transferred_from?: string[] | null;
  transferred_to?: string[] | null;
}

export type SubscriptionStatus = 'active' | 'grace' | 'expired' | 'cancelled' | 'refunded';

export interface UpsertAction {
  kind: 'upsert';
  tier: 'plus' | 'pro';
  period: 'monthly' | 'yearly' | 'lifetime';
  status: SubscriptionStatus;
  current_period_end: string | null;
  store: 'play' | 'appstore' | 'promo';
  store_txn_id: string;
  price_minor: number | null;
  currency: string | null;
  country_code: string | null;
}

export interface TransferAction {
  kind: 'transfer';
  from: string[];
  to: string;
}

export interface IgnoreAction {
  kind: 'ignore';
  reason: string;
}

export type Action = UpsertAction | TransferAction | IgnoreAction;

export interface Mapped {
  eventId: string;
  type: string;
  appUserId: string | null;
  eventAt: string | null;
  action: Action;
}

/** RevenueCat's store names → the `subscriptions.store` vocabulary. */
export function storeFor(store: string | null | undefined): UpsertAction['store'] | null {
  switch ((store ?? '').toUpperCase()) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'appstore';
    case 'PLAY_STORE':
      return 'play';
    case 'PROMOTIONAL':
      return 'promo';
    default:
      return null;
  }
}

const ACTIVE_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'SUBSCRIPTION_EXTENDED',
  'REFUND_REVERSED',
  'PRODUCT_CHANGE',
]);
const HANDLED_TYPES = new Set([
  ...ACTIVE_TYPES,
  'CANCELLATION',
  'BILLING_ISSUE',
  'EXPIRATION',
  'REFUND',
]);

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toISOString()
    : null;
}

function asPaid(tier: PlanTier | null): 'plus' | 'pro' | null {
  return tier === PlanTier.Pro ? 'pro' : tier === PlanTier.Plus ? 'plus' : null;
}

/** The tier an event's own product grants: the entitlements RevenueCat attached, else the id. */
export function tierOf(event: RcEvent): 'plus' | 'pro' | null {
  const ids = event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : []);
  const fromEntitlements = tierFromEntitlementIds(ids);
  if (fromEntitlements !== PlanTier.Free) return asPaid(fromEntitlements);
  return asPaid(tierFromProductId(event.product_id));
}

/** Price in minor units, only for a positive charge in a real currency (refunds are negative). */
export function priceMinor(event: RcEvent): { minor: number; currency: string } | null {
  const amount = event.price_in_purchased_currency;
  const currency = (event.currency ?? '').toUpperCase();
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  if (!isCurrencyCode(currency)) return null;
  const exponent = minorUnitExponent(currency as CurrencyCode);
  return { minor: Math.round(amount * 10 ** exponent), currency };
}

export function statusFor(event: RcEvent): SubscriptionStatus {
  switch (event.type) {
    case 'BILLING_ISSUE':
      return 'grace';
    case 'EXPIRATION':
      return 'expired';
    case 'REFUND':
      return 'refunded';
    case 'CANCELLATION':
      // A cancellation only switches the renewal off; the person keeps what
      // they paid for until it expires. A support cancellation is a refund.
      return (event.cancel_reason ?? '').toUpperCase() === 'CUSTOMER_SUPPORT'
        ? 'refunded'
        : 'active';
    default:
      return 'active';
  }
}

export function mapEvent(event: RcEvent, options: { ignoreSandbox?: boolean } = {}): Mapped {
  const eventId = typeof event.id === 'string' ? event.id.trim() : '';
  const type = typeof event.type === 'string' ? event.type.toUpperCase() : '';
  const appUserId = typeof event.app_user_id === 'string' ? event.app_user_id : null;
  const eventAt = iso(event.event_timestamp_ms);
  const base = { eventId, type, appUserId, eventAt };
  const ignore = (reason: string): Mapped => ({ ...base, action: { kind: 'ignore', reason } });

  if (options.ignoreSandbox && (event.environment ?? '').toUpperCase() === 'SANDBOX') {
    return ignore('sandbox');
  }

  if (type === 'TRANSFER') {
    const to = (event.transferred_to ?? []).find((id) => typeof id === 'string');
    if (!to) return ignore('transfer without a destination');
    return {
      ...base,
      appUserId: to,
      action: {
        kind: 'transfer',
        from: (event.transferred_from ?? []).filter((id) => typeof id === 'string'),
        to,
      },
    };
  }

  if (!HANDLED_TYPES.has(type)) return ignore(`unhandled type ${type || '(none)'}`);

  const store = storeFor(event.store);
  if (!store) return ignore(`unsupported store ${event.store ?? '(none)'}`);

  const txn = event.original_transaction_id || event.transaction_id;
  if (!txn) return ignore('no transaction id');

  let tier = tierOf(event);
  let productId = event.product_id ?? null;
  if (type === 'PRODUCT_CHANGE') {
    const next = asPaid(tierFromProductId(event.new_product_id));
    const rank = (t: 'plus' | 'pro' | null) =>
      tierRank(t === 'pro' ? PlanTier.Pro : t === 'plus' ? PlanTier.Plus : PlanTier.Free);
    if (next && rank(next) > rank(tier)) {
      tier = next;
      productId = event.new_product_id ?? productId;
    }
  }
  if (!tier) return ignore(`not a Waves product ${event.product_id ?? '(none)'}`);

  const status = statusFor(event);
  const expiration =
    status === 'grace'
      ? (iso(event.grace_period_expiration_at_ms) ?? iso(event.expiration_at_ms))
      : iso(event.expiration_at_ms);

  let period: UpsertAction['period'];
  let end: string | null;
  const named =
    periodFromProductId(productId ? baseProductId(productId) : null) ??
    periodFromProductId(productId);
  if (expiration) {
    end = expiration;
    if (named) {
      period = named;
    } else {
      const start = event.purchased_at_ms ?? event.event_timestamp_ms ?? Date.parse(expiration);
      period = Date.parse(expiration) - start > 40 * 86_400_000 ? 'yearly' : 'monthly';
    }
  } else if (named) {
    // A subscription with no expiration date on the event (an EXPIRATION or a
    // refund can arrive without one): it ended now.
    period = named;
    end = eventAt ?? new Date().toISOString();
  } else {
    period = 'lifetime';
    end = null;
  }

  const price = type === 'REFUND' || status === 'refunded' ? null : priceMinor(event);
  const country = (event.country_code ?? '').toUpperCase();

  return {
    ...base,
    action: {
      kind: 'upsert',
      tier,
      period,
      status,
      current_period_end: end,
      store,
      store_txn_id: txn,
      price_minor: price?.minor ?? null,
      currency: price?.currency ?? null,
      country_code: /^[A-Z]{2}$/.test(country) ? country : null,
    },
  };
}
