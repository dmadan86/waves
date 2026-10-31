/**
 * The pure half of the Purchases screen: CustomerInfo + the `subscriptions`
 * row -> one status. No React, no native module (test/purchaseStatus.test.ts).
 */

export type PurchaseStatus =
  'active' | 'trial' | 'renewsOff' | 'billingIssue' | 'expired' | 'refunded' | 'promo';

/** Where a plan was bought: a store the app can manage, or nowhere (promo, web, test). */
export type StoreKind = 'play' | 'apple' | 'none';

export interface SubscriptionRow {
  readonly tier: string | null;
  readonly period: string | null;
  readonly status: string | null;
  readonly current_period_end: string | null;
  readonly store: string | null;
  readonly store_txn_id: string | null;
  readonly price_minor: number | null;
  readonly currency: string | null;
}

export interface EntitlementLike {
  readonly productIdentifier?: string;
  readonly store?: string;
  readonly expirationDate?: string | null;
  readonly willRenew?: boolean;
  readonly periodType?: string;
  readonly billingIssueDetectedAt?: string | null;
  readonly isSandbox?: boolean;
}

export interface InfoLike {
  readonly entitlements: { readonly active: Readonly<Record<string, EntitlementLike>> };
}

/** The live entitlement, Pro first (a legacy Plus one still counts). */
export function activeEntitlement(info: InfoLike | null | undefined): EntitlementLike | null {
  return info?.entitlements.active.pro ?? info?.entitlements.active.plus ?? null;
}

export function storeKind(store: string | null | undefined): StoreKind {
  const s = (store ?? '').toLowerCase();
  if (s.includes('play')) return 'play';
  if (s.includes('app')) return 'apple';
  return 'none';
}

export function purchaseStatus(
  info: InfoLike | null | undefined,
  row: SubscriptionRow | null | undefined,
  now: number = Date.now(),
): PurchaseStatus | null {
  if (row?.status === 'refunded') return 'refunded';
  const ent = activeEntitlement(info);
  if (ent) {
    if (storeKind(ent.store ?? row?.store) === 'none') return 'promo';
    if (ent.billingIssueDetectedAt || row?.status === 'grace') return 'billingIssue';
    if (ent.periodType?.toUpperCase() === 'TRIAL') return 'trial';
    if (ent.willRenew === false) return 'renewsOff';
    return 'active';
  }
  // No live entitlement (offline, no SDK key): fall back to what the server last wrote.
  if (!row) return null;
  const over = row.current_period_end ? Date.parse(row.current_period_end) < now : false;
  if (row.status === 'expired' || over) return 'expired';
  if (row.status === 'grace') return 'billingIssue';
  return storeKind(row.store) === 'none' ? 'promo' : 'active';
}

export function isYearly(
  ent: EntitlementLike | null,
  row: SubscriptionRow | null | undefined,
): boolean {
  const p = `${row?.period ?? ''} ${ent?.productIdentifier ?? ''}`.toLowerCase();
  return p.includes('year') || p.includes('annual');
}
