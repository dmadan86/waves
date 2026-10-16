/**
 * The paywall against the offering the RevenueCat dashboard really has: the
 * "default" offering with packages `$rc_monthly`, `$rc_annual`, `pro_monthly`
 * and `pro_annual`, whose product ids differ per store (Play appends the base
 * plan, App Store and Test Store do not).
 *
 * The live check that the dashboard still looks like this is
 * packages/core/test/revenuecat.live.test.ts. This file pins what the app does
 * with that shape, including the "Plans could not be loaded" failure where the
 * offering held only RevenueCat's sample products.
 */

import { describe, expect, it } from 'vitest';

import { PlanTier, RC_PRODUCT_IDS } from '@waves/core';

import {
  chosenCard,
  ctaState,
  periodsInOffering,
  planCardsFromOffering,
  selectOffering,
  tierOfPackage,
  type OfferingLike,
  type PackageLike,
} from '../src/lib/pricing';

const product = (identifier: string, price: number) => ({
  identifier,
  price,
  priceString: `$${price.toFixed(2)}`,
  currencyCode: 'USD',
});

const pkg = (identifier: string, packageType: string, id: string, price: number): PackageLike => ({
  identifier,
  packageType,
  product: product(id, price),
});

/** The two Pro packages, with product ids as one store reports them. */
function offeringFor(ids: { proMonthly: string; proYearly: string }): OfferingLike {
  return {
    identifier: 'default',
    availablePackages: [
      pkg('pro_monthly', 'CUSTOM', ids.proMonthly, 1.49),
      pkg('pro_annual', 'CUSTOM', ids.proYearly, 13.99),
    ],
  };
}

const STORES = {
  'Google Play': {
    proMonthly: `${RC_PRODUCT_IDS.proMonthly}:monthly`,
    proYearly: `${RC_PRODUCT_IDS.proYearly}:yearly`,
  },
  'App Store': { ...RC_PRODUCT_IDS },
  'Test Store': { ...RC_PRODUCT_IDS },
} as const;

describe.each(Object.entries(STORES))('the default offering on %s', (_store, ids) => {
  const offering = offeringFor(ids);

  it('sells both periods', () => {
    expect(periodsInOffering(offering)).toEqual(['monthly', 'yearly']);
  });

  it('shows the one Pro card for Monthly, with the store’s own price', () => {
    expect(planCardsFromOffering(offering, 'monthly')).toMatchObject([
      { tier: PlanTier.Pro, packageId: 'pro_monthly', priceString: '$1.49', period: 'monthly' },
    ]);
  });

  it('shows the one Pro card for Yearly, from the pro_annual package', () => {
    expect(planCardsFromOffering(offering, 'yearly')).toMatchObject([
      { tier: PlanTier.Pro, packageId: 'pro_annual', priceString: '$13.99', period: 'yearly' },
    ]);
  });

  it('starts on Pro, and the buy button targets the Pro package', () => {
    const cards = planCardsFromOffering(offering, 'monthly');
    expect(chosenCard(cards, PlanTier.Pro)?.packageId).toBe('pro_monthly');
    expect(
      ctaState({
        chosen: chosenCard(cards, PlanTier.Pro),
        current: PlanTier.Free,
        purchasing: false,
      }),
    ).toEqual({ kind: 'continue', disabled: false });
    expect(
      ctaState({
        chosen: chosenCard(cards, PlanTier.Pro),
        current: PlanTier.Pro,
        purchasing: false,
      }),
    ).toEqual({ kind: 'current', disabled: true });
  });
});

describe('an offering holding only RevenueCat’s sample products (the "Plans could not be loaded" bug)', () => {
  const samples: OfferingLike = {
    identifier: 'default',
    availablePackages: [
      pkg('$rc_monthly', 'MONTHLY', 'monthly', 0.99),
      pkg('$rc_annual', 'ANNUAL', 'yearly', 9.99),
      pkg('$rc_lifetime', 'LIFETIME', 'lifetime', 29.99),
    ],
  };

  it('gives the paywall no cards and no period switch, so it shows its empty state', () => {
    expect(planCardsFromOffering(samples, 'monthly')).toEqual([]);
    expect(planCardsFromOffering(samples, 'yearly')).toEqual([]);
    expect(periodsInOffering(samples)).toEqual([]);
  });

  it('recognises no package as Pro', () => {
    expect(samples.availablePackages.map(tierOfPackage)).toEqual([null, null, null]);
  });
});

describe('an offering that still holds the retired Plus packages', () => {
  const dflt = offeringFor(STORES['App Store']);
  const leftover: OfferingLike = {
    identifier: 'default',
    availablePackages: [
      // Listed first on purpose: the old product must never stand in for the Pro card.
      pkg('$rc_monthly', 'MONTHLY', 'waves_plus_monthly', 0.99),
      pkg('$rc_annual', 'ANNUAL', 'waves_plus_yearly', 9.99),
      ...dflt.availablePackages,
    ],
  };

  it('shows only the Pro cards, never a retired Plus product under the Pro name', () => {
    expect(planCardsFromOffering(leftover, 'monthly')).toMatchObject([
      { tier: PlanTier.Pro, packageId: 'pro_monthly', priceString: '$1.49' },
    ]);
    expect(planCardsFromOffering(leftover, 'yearly')).toMatchObject([
      { tier: PlanTier.Pro, packageId: 'pro_annual', priceString: '$13.99' },
    ]);
  });

  it('shows nothing when Pro is missing and only Plus remains', () => {
    const plusOnly: OfferingLike = {
      identifier: 'default',
      availablePackages: leftover.availablePackages.slice(0, 2),
    };
    expect(planCardsFromOffering(plusOnly, 'monthly')).toEqual([]);
    expect(periodsInOffering(plusOnly)).toEqual([]);
  });
});

describe('the retired Plus price-test arms', () => {
  const dflt = offeringFor(STORES['App Store']);
  const arm: OfferingLike = { identifier: 'plus_p79', availablePackages: [] };

  it('are ignored: the current offering (else default) is always the one shown', () => {
    expect(selectOffering({ current: dflt, all: { default: dflt, plus_p79: arm } })).toBe(dflt);
    expect(selectOffering({ current: null, all: { default: dflt, plus_p79: arm } })).toBe(dflt);
    expect(selectOffering({ current: null, all: {} })).toBeNull();
  });
});
