/**
 * The pure logic behind the paywall: RevenueCat offering → plan cards, and
 * RevenueCat CustomerInfo → tier. No React and no native module, so all of it
 * runs under vitest (test/pricing.test.ts); `lib/purchases.ts` is the thin
 * native half.
 *
 * Tiers: **Plus** is the paid features without the advanced voice agent,
 * **Pro** is everything. Prices are always the store's own `priceString` —
 * Waves never hardcodes what a person is charged (₹49 / ₹99 a month in India
 * are configured in the stores, and every other market's price lives there).
 *
 * What the app reads here is for display only. The server decides what a
 * person gets from `subscriptions`, which RevenueCat's webhook writes
 * (supabase/functions/revenuecat-webhook) — see docs/pricing.md.
 */

import {
  PlanTier,
  RC_DEFAULT_OFFERING,
  periodFromProductId,
  tierFromEntitlementIds,
  tierFromProductId,
} from '@waves/core';

export type PaidTier = PlanTier.Plus | PlanTier.Pro;
export type PlanPeriod = 'monthly' | 'yearly';

/** Paywall order: the cheaper plan first, Pro last (it is the one with more on it). */
export const PAID_TIERS: readonly PaidTier[] = [PlanTier.Plus, PlanTier.Pro];

/** The fields of RevenueCat's `PurchasesStoreProduct` the paywall reads. */
export interface StoreProductLike {
  readonly identifier: string;
  readonly price: number;
  readonly priceString: string;
  readonly currencyCode: string;
}

/** The fields of RevenueCat's `PurchasesPackage` the paywall reads. */
export interface PackageLike {
  readonly identifier: string;
  readonly packageType: string;
  readonly product: StoreProductLike;
}

/** The fields of RevenueCat's `PurchasesOffering` the paywall reads. */
export interface OfferingLike {
  readonly identifier: string;
  readonly availablePackages: readonly PackageLike[];
}

/** The fields of RevenueCat's `CustomerInfo` the app reads. */
export interface CustomerInfoLike {
  readonly entitlements: {
    readonly active: Readonly<
      Record<string, { readonly isActive?: boolean; readonly productIdentifier?: string }>
    >;
  };
}

/** One card on the paywall. */
export interface PlanCardModel {
  readonly tier: PaidTier;
  readonly period: PlanPeriod;
  /** The RevenueCat package identifier, which is what gets purchased. */
  readonly packageId: string;
  readonly productId: string;
  /** Localized by the store, e.g. "₹49.00". */
  readonly priceString: string;
  readonly price: number;
  readonly currency: string;
}

/** The tier a package sells, from its product id or, failing that, its package id. */
export function tierOfPackage(pkg: PackageLike): PaidTier | null {
  const tier = tierFromProductId(pkg.product.identifier) ?? tierFromProductId(pkg.identifier);
  return tier === PlanTier.Plus || tier === PlanTier.Pro ? tier : null;
}

/** The billing period of a package: RevenueCat's package type, else the ids. */
export function periodOfPackage(pkg: PackageLike): PlanPeriod | null {
  if (pkg.packageType === 'MONTHLY') return 'monthly';
  if (pkg.packageType === 'ANNUAL') return 'yearly';
  return periodFromProductId(pkg.identifier) ?? periodFromProductId(pkg.product.identifier);
}

/**
 * The paywall's cards for one billing period: at most one Plus and one Pro, in
 * that order. A tier the offering does not sell for that period has no card.
 */
export function planCardsFromOffering(
  offering: OfferingLike | null | undefined,
  period: PlanPeriod,
): PlanCardModel[] {
  if (!offering) return [];
  const cards: PlanCardModel[] = [];
  for (const tier of PAID_TIERS) {
    const pkg = offering.availablePackages.find(
      (candidate) => tierOfPackage(candidate) === tier && periodOfPackage(candidate) === period,
    );
    if (!pkg) continue;
    cards.push({
      tier,
      period,
      packageId: pkg.identifier,
      productId: pkg.product.identifier,
      priceString: pkg.product.priceString,
      price: pkg.product.price,
      currency: pkg.product.currencyCode,
    });
  }
  return cards;
}

/** Which periods the offering sells anything for, monthly first. Annual comes later. */
export function periodsInOffering(offering: OfferingLike | null | undefined): PlanPeriod[] {
  return (['monthly', 'yearly'] as const).filter(
    (period) => planCardsFromOffering(offering, period).length > 0,
  );
}

/** The tier RevenueCat says this phone's account holds. Display only. */
export function tierFromCustomerInfo(info: CustomerInfoLike | null | undefined): PlanTier {
  if (!info) return PlanTier.Free;
  const active = Object.entries(info.entitlements.active)
    .filter(([, entitlement]) => entitlement.isActive !== false)
    .map(([id]) => id);
  return tierFromEntitlementIds(active);
}

/**
 * The store product behind the person's current paid entitlement, if any —
 * Android needs it to turn a Plus → Pro purchase into an upgrade of the same
 * subscription rather than a second one.
 */
export function activeProductId(info: CustomerInfoLike | null | undefined): string | null {
  if (!info) return null;
  const active = info.entitlements.active;
  const entitlement = active.pro ?? active.plus;
  const id = entitlement?.productIdentifier;
  return id ? id.split(':')[0]! : null;
}

/**
 * The RevenueCat public SDK key for this platform, or null when the build has
 * none — in which case there is nothing to buy and the paywall stays hidden.
 *
 * A Test Store key (`test_…`) counts only in a development build. The SDK
 * refuses one in a release build: it shows "Wrong API Key" and closes the app.
 * Treating it as no key leaves a release build that picked one up from a local
 * `.env` working, just with nothing to sell.
 */
export function revenueCatApiKey(
  os: string,
  env: { ios?: string | undefined; android?: string | undefined },
  dev: boolean,
): string | null {
  const key = os === 'ios' ? env.ios : os === 'android' ? env.android : undefined;
  const trimmed = key?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('test_') && !dev) return null;
  return trimmed;
}

/** The yearly plan's saving over twelve monthly payments, as a whole percent. */
export function yearlySavingsPercent(monthlyPrice: number, yearlyPrice: number): number {
  if (!(monthlyPrice > 0)) return 0;
  const savings = 1 - yearlyPrice / (monthlyPrice * 12);
  return Math.max(0, Math.round(savings * 100));
}

// --- The Plus price test ------------------------------------------------------

/** The feature flag that assigns a person one of the Plus price arms. */
export const PLUS_PRICE_FLAG = 'plus_price';

/** The arms, as the flag names them. Each maps to the offering `plus_<arm>`. */
export const PLUS_PRICE_VARIANTS = ['p49', 'p79', 'p99'] as const;
export type PlusPriceVariant = (typeof PLUS_PRICE_VARIANTS)[number];

export function isPlusPriceVariant(value: unknown): value is PlusPriceVariant {
  return typeof value === 'string' && (PLUS_PRICE_VARIANTS as readonly string[]).includes(value);
}

/** The RevenueCat offering id for an arm (`p79` becomes `plus_p79`), or null for no arm. */
export function plusPriceOfferingId(variant: string | null | undefined): string | null {
  return isPlusPriceVariant(variant) ? `plus_${variant}` : null;
}

/** The fields of RevenueCat's `PurchasesOfferings` that picking an offering reads. */
export interface OfferingsLike<T extends { readonly identifier: string }> {
  readonly current: T | null;
  readonly all: Readonly<Record<string, T | undefined>>;
}

/**
 * The offering the paywall shows. A person in a Plus price arm gets that arm's
 * offering; anybody else, or an arm whose offering is not set up in
 * RevenueCat, gets what the app showed before the test: the current offering,
 * else 'default'. A missing offering therefore never breaks the paywall.
 */
export function selectOffering<T extends { readonly identifier: string }>(
  offerings: OfferingsLike<T>,
  variant: string | null | undefined,
): T | null {
  const armId = plusPriceOfferingId(variant);
  const arm = armId ? offerings.all[armId] : undefined;
  return arm ?? offerings.current ?? offerings.all[RC_DEFAULT_OFFERING] ?? null;
}
