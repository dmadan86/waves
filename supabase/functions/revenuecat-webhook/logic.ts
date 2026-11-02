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
 *   TEMPORARY_ENTITLEMENT_GRANT             → active until expiration: RevenueCat's
 *                                             stand-in while a store is down, so the
 *                                             person is not locked out of what they just
 *                                             paid for. Its own row (the real purchase,
 *                                             when it lands, writes another), keyed by
 *                                             the event when there is no transaction
 *   CANCELLATION                            → stays active until expiration (it only
 *                                             stops the renewal); refunded when the
 *                                             reason is CUSTOMER_SUPPORT (a store refund)
 *   BILLING_ISSUE                           → grace until the grace period ends
 *   EXPIRATION                              → expired
 *   REFUND                                  → refunded
 *   TRANSFER                                → store rows move to the new profile
 *   TEST and anything else                  → recorded, nothing written
 *
 * RevenueCat's Test Store (a `test_` SDK key) writes rows with store 'test', so
 * a test purchase unlocks what a real one would. It counts as sandbox: unless
 * the deployment opts in (handler.ts, REVENUECAT_ALLOW_SANDBOX=true), its
 * events are dropped like any other sandbox event.
 */

import {
  baseProductId,
  isRetiredPlusProduct,
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
  subscriber_attributes?: Record<string, { value?: string | null } | undefined> | null;
}

export type SubscriptionStatus = 'active' | 'grace' | 'expired' | 'cancelled' | 'refunded';

export interface UpsertAction {
  kind: 'upsert';
  tier: 'pro';
  period: 'monthly' | 'yearly' | 'lifetime';
  status: SubscriptionStatus;
  current_period_end: string | null;
  store: 'play' | 'appstore' | 'promo' | 'test';
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

/** A company storage pack (waves_company_storage_1gb / _5gb): sets that company's quota, not a Pro row. */
export interface CompanyStorageAction {
  kind: 'company_storage';
  /** From the `company_group_id` subscriber attribute; null when the event carries none. */
  group_id: string | null;
  /** 0 when the pack ended (expired, refunded); the server then reverts to the free default. */
  pack_bytes: number;
  store_txn_id: string;
}

/** A company slot (waves_company_slot_monthly): one extra owned company, bound server-side on creation. */
export interface CompanySlotAction {
  kind: 'company_slot';
  /** False once the subscription ended (expired, refunded); the bound company then turns read-only. */
  active: boolean;
  store_txn_id: string;
}

export interface IgnoreAction {
  kind: 'ignore';
  reason: string;
}

export type Action =
  UpsertAction | TransferAction | CompanyStorageAction | CompanySlotAction | IgnoreAction;

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
    case 'TEST_STORE':
      return 'test';
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
  'TEMPORARY_ENTITLEMENT_GRANT',
]);
const HANDLED_TYPES = new Set([
  ...ACTIVE_TYPES,
  'CANCELLATION',
  'BILLING_ISSUE',
  'EXPIRATION',
  'REFUND',
]);

const GIB = 1024 ** 3;
/** Company storage pack products (monthly subscriptions) and the bytes each adds. */
export const COMPANY_PACKS: Readonly<Record<string, number>> = {
  waves_company_storage_1gb: GIB,
  waves_company_storage_5gb: 5 * GIB,
};
export function companyPackBytes(productId: string | null | undefined): number | null {
  if (!productId) return null;
  return COMPANY_PACKS[baseProductId(productId)] ?? COMPANY_PACKS[productId] ?? null;
}

/**
 * The company slot subscription, one constant to edit once the owner creates the products
 * (the app mirrors it in apps/mobile/src/lib/companySlots.ts). Same id on Android and iOS.
 */
export const COMPANY_SLOT_PRODUCT_IDS: readonly string[] = ['waves_company_slot_monthly'];
export const COMPANY_SLOT_ENTITLEMENT = 'company_slot';
export function isCompanySlot(event: RcEvent): boolean {
  const ids = event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : []);
  const product = event.product_id ?? '';
  return (
    ids.includes(COMPANY_SLOT_ENTITLEMENT) ||
    COMPANY_SLOT_PRODUCT_IDS.includes(baseProductId(product)) ||
    COMPANY_SLOT_PRODUCT_IDS.includes(product)
  );
}

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toISOString()
    : null;
}

// Plus is retired: the core mapping already reads a Plus entitlement or product as
// Pro, so every paid event becomes a 'pro' row. Nothing writes 'plus'.
function asPaid(tier: PlanTier | null): 'pro' | null {
  return tier === PlanTier.Pro ? 'pro' : null;
}

/** The tier an event's own product grants: the entitlements RevenueCat attached, else the id. */
export function tierOf(event: RcEvent): 'pro' | null {
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

  const sandbox =
    (event.environment ?? '').toUpperCase() === 'SANDBOX' ||
    (event.store ?? '').toUpperCase() === 'TEST_STORE';
  if (options.ignoreSandbox && sandbox) {
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

  const txn =
    event.original_transaction_id ||
    event.transaction_id ||
    (type === 'TEMPORARY_ENTITLEMENT_GRANT' && eventId ? `temp:${eventId}` : null);
  if (!txn) return ignore('no transaction id');

  // A company slot never grants Pro or a quota: it only lets its buyer own one more company.
  if (isCompanySlot(event)) {
    const status = statusFor(event);
    return {
      ...base,
      action: {
        kind: 'company_slot',
        active: status === 'active' || status === 'grace',
        store_txn_id: txn,
      },
    };
  }

  // A company storage pack changes one company's quota; it is never a Pro subscription.
  // A change to a bigger pack applies now; a downgrade keeps the current pack until its renewal
  // arrives as a RENEWAL of the new product (the stores apply downgrades at the period end).
  const upgrade =
    type === 'PRODUCT_CHANGE' &&
    (companyPackBytes(event.new_product_id) ?? 0) > (companyPackBytes(event.product_id) ?? 0);
  const packProduct = upgrade ? event.new_product_id : event.product_id;
  const pack = companyPackBytes(packProduct);
  if (pack !== null) {
    const status = statusFor(event);
    const live = status === 'active' || status === 'grace';
    const group = event.subscriber_attributes?.company_group_id?.value;
    return {
      ...base,
      action: {
        kind: 'company_storage',
        group_id: typeof group === 'string' && group.trim() ? group.trim() : null,
        pack_bytes: live ? pack : 0,
        store_txn_id: txn,
      },
    };
  }

  let tier = tierOf(event);
  let productId = event.product_id ?? null;
  if (type === 'PRODUCT_CHANGE') {
    const next = asPaid(tierFromProductId(event.new_product_id));
    const rank = (t: 'pro' | null) => tierRank(t === 'pro' ? PlanTier.Pro : PlanTier.Free);
    // An upgrade to a higher tier applies now. With Plus retired both products are
    // Pro, so the move that is an upgrade is off a retired Plus product onto a
    // current Pro one: that applies now too, with the new product's period.
    const leavesRetiredPlus =
      isRetiredPlusProduct(event.product_id) && !isRetiredPlusProduct(event.new_product_id);
    if (next && (rank(next) > rank(tier) || leavesRetiredPlus)) {
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
