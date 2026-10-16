/**
 * The pure logic behind the paywall: RevenueCat offering → plan cards, and
 * RevenueCat CustomerInfo → tier. No React and no native module, so all of it
 * runs under vitest (test/pricing.test.ts); `lib/purchases.ts` is the thin
 * native half.
 *
 * Tiers: Free and **Pro** (Plus was retired; a Plus subscriber is Pro). Prices are
 * always the store's own `priceString` — Waves never hardcodes what a person is
 * charged (₹79 a month / ₹699 a year in India are configured in the stores, and
 * every other market's price lives there).
 *
 * What the app reads here is for display only. The server decides what a
 * person gets from `subscriptions`, which RevenueCat's webhook writes
 * (supabase/functions/revenuecat-webhook) — see docs/pricing.md.
 */

import {
  PlanTier,
  RC_DEFAULT_OFFERING,
  isRetiredPlusProduct,
  periodFromProductId,
  tierFromEntitlementIds,
  tierFromProductId,
} from '@waves/core';

export type PaidTier = PlanTier.Pro;
export type PlanPeriod = 'monthly' | 'yearly';

/** The one paid tier. */
export const PAID_TIERS: readonly PaidTier[] = [PlanTier.Pro];

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
  /** Localized by the store, e.g. "₹79.00". */
  readonly priceString: string;
  readonly price: number;
  readonly currency: string;
}

/** The tier a package sells, from its product id or, failing that, its package id. */
export function tierOfPackage(pkg: PackageLike): PaidTier | null {
  // A retired Plus product reads as Pro for a subscriber who already has it, but it
  // is not for sale: a leftover Plus package in an old offering must not appear as
  // a Pro card (it would sell the old product under the new name).
  if (isRetiredPlusProduct(pkg.product.identifier) || isRetiredPlusProduct(pkg.identifier)) {
    return null;
  }
  const tier = tierFromProductId(pkg.product.identifier) ?? tierFromProductId(pkg.identifier);
  return tier === PlanTier.Pro ? tier : null;
}

/** The billing period of a package: RevenueCat's package type, else the ids. */
export function periodOfPackage(pkg: PackageLike): PlanPeriod | null {
  if (pkg.packageType === 'MONTHLY') return 'monthly';
  if (pkg.packageType === 'ANNUAL') return 'yearly';
  return periodFromProductId(pkg.identifier) ?? periodFromProductId(pkg.product.identifier);
}

/**
 * The paywall's cards for one billing period: at most one Pro card. A tier the offering does not sell for that period has no card.
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
 * Android needs it to turn a change of product into an upgrade of the same
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

/** The fields of RevenueCat's `PurchasesOfferings` that picking an offering reads. */
export interface OfferingsLike<T extends { readonly identifier: string }> {
  readonly current: T | null;
  readonly all: Readonly<Record<string, T | undefined>>;
}

/**
 * The offering the paywall shows: the current one, else 'default'. (The Plus
 * price-test arms `plus_p49` / `plus_p79` / `plus_p99` are retired and ignored.)
 */
export function selectOffering<T extends { readonly identifier: string }>(
  offerings: OfferingsLike<T>,
): T | null {
  return offerings.current ?? offerings.all[RC_DEFAULT_OFFERING] ?? null;
}

// --- Paywall presentation -----------------------------------------------------

/** Which plan the paywall starts on: Pro, the only paid one. */
export function defaultSelectedTier(): PaidTier {
  return PlanTier.Pro;
}

/** The card the buy button acts on: the selected one, else the last (Pro, the only one). */
export function chosenCard(
  cards: readonly PlanCardModel[],
  selected: PaidTier,
): PlanCardModel | undefined {
  return cards.find((card) => card.tier === selected) ?? cards[cards.length - 1];
}

export type CtaKind = 'continue' | 'current' | 'busy';

/** What the primary button says and whether it can be pressed. */
export function ctaState(input: {
  chosen: Pick<PlanCardModel, 'tier'> | undefined;
  current: PlanTier;
  purchasing: boolean;
}): { kind: CtaKind; disabled: boolean } {
  const { chosen, current, purchasing } = input;
  if (!chosen) return { kind: 'continue', disabled: true };
  if (chosen.tier === current) return { kind: 'current', disabled: true };
  if (purchasing) return { kind: 'busy', disabled: true };
  return { kind: 'continue', disabled: false };
}

/** The hero says "Upgrade to Waves Pro" to everyone who is not already on Pro. */
export function showUpgradeHero(current: PlanTier): boolean {
  return current !== PlanTier.Pro;
}

/** The empty paywall: the offering loaded but sells nothing we recognise, or it failed to load. */
export function paywallEmptyReason(loadFailed: boolean): 'network' | 'no-plans' {
  return loadFailed ? 'network' : 'no-plans';
}
