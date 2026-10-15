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

/** The four packages, with product ids as one store reports them. */
function offeringFor(ids: {
  plusMonthly: string;
  plusYearly: string;
  proMonthly: string;
  proYearly: string;
}): OfferingLike {
  return {
    identifier: 'default',
    availablePackages: [
      pkg('$rc_monthly', 'MONTHLY', ids.plusMonthly, 0.99),
      pkg('$rc_annual', 'ANNUAL', ids.plusYearly, 9.99),
      pkg('pro_monthly', 'CUSTOM', ids.proMonthly, 1.99),
      pkg('pro_annual', 'CUSTOM', ids.proYearly, 19.99),
    ],
  };
}

const STORES = {
  'Google Play': {
    plusMonthly: `${RC_PRODUCT_IDS.plusMonthly}:monthly`,
    plusYearly: `${RC_PRODUCT_IDS.plusYearly}:yearly`,
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

  it('shows Plus then Pro for Monthly, with the store’s own prices', () => {
    expect(planCardsFromOffering(offering, 'monthly')).toMatchObject([
      { tier: PlanTier.Plus, packageId: '$rc_monthly', priceString: '$0.99', period: 'monthly' },
      { tier: PlanTier.Pro, packageId: 'pro_monthly', priceString: '$1.99', period: 'monthly' },
    ]);
  });

  it('shows Plus then Pro for Yearly, from the $rc_annual and pro_annual packages', () => {
    expect(planCardsFromOffering(offering, 'yearly')).toMatchObject([
      { tier: PlanTier.Plus, packageId: '$rc_annual', priceString: '$9.99', period: 'yearly' },
      { tier: PlanTier.Pro, packageId: 'pro_annual', priceString: '$19.99', period: 'yearly' },
    ]);
  });

  it('starts on Pro, and the buy button targets the package of the plan chosen', () => {
    const cards = planCardsFromOffering(offering, 'monthly');
    expect(chosenCard(cards, PlanTier.Pro)?.packageId).toBe('pro_monthly');
    expect(chosenCard(cards, PlanTier.Plus)?.packageId).toBe('$rc_monthly');
    expect(
      ctaState({
        chosen: chosenCard(cards, PlanTier.Plus),
        current: PlanTier.Free,
        purchasing: false,
      }),
    ).toEqual({ kind: 'continue', disabled: false });
    expect(
      ctaState({
        chosen: chosenCard(cards, PlanTier.Plus),
        current: PlanTier.Plus,
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

  it('recognises no package as Plus or Pro', () => {
    expect(samples.availablePackages.map(tierOfPackage)).toEqual([null, null, null]);
  });
});

describe('an offering with a tier missing', () => {
  it('shows the cards it has and lets the CTA fall back to the last one', () => {
    const plusOnly: OfferingLike = {
      identifier: 'default',
      availablePackages: offeringFor(STORES['App Store']).availablePackages.slice(0, 2),
    };
    const cards = planCardsFromOffering(plusOnly, 'monthly');
    expect(cards.map((c) => c.tier)).toEqual([PlanTier.Plus]);
    expect(chosenCard(cards, PlanTier.Pro)?.tier).toBe(PlanTier.Plus);
  });
});

describe('the Plus price test arms are whole offerings', () => {
  const dflt = offeringFor(STORES['App Store']);
  const p79: OfferingLike = {
    identifier: 'plus_p79',
    availablePackages: [
      pkg('$rc_monthly', 'MONTHLY', 'waves_plus_monthly_p79', 0.79),
      ...dflt.availablePackages.slice(1),
    ],
  };

  it('shows the arm’s Plus price and the unchanged Pro price', () => {
    const picked = selectOffering({ current: dflt, all: { default: dflt, plus_p79: p79 } }, 'p79')!;
    expect(planCardsFromOffering(picked, 'monthly')).toMatchObject([
      { tier: PlanTier.Plus, priceString: '$0.79' },
      { tier: PlanTier.Pro, priceString: '$1.99' },
    ]);
  });
});
