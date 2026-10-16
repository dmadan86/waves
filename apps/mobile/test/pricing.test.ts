/**
 * The pure logic behind the paywall: RevenueCat offering → plan cards and
 * CustomerInfo → tier. No React, no store, no native module — see
 * src/lib/pricing.ts.
 */

import { describe, expect, it } from 'vitest';

import { PlanTier } from '@waves/core';

import {
  chosenCard,
  ctaState,
  defaultSelectedTier,
  paywallEmptyReason,
  showUpgradeHero,
  activeProductId,
  selectOffering,
  periodOfPackage,
  periodsInOffering,
  planCardsFromOffering,
  revenueCatApiKey,
  tierFromCustomerInfo,
  tierOfPackage,
  yearlySavingsPercent,
  type OfferingLike,
  type PackageLike,
  type PaidTier,
} from '../src/lib/pricing';

function pkg(
  identifier: string,
  productId: string,
  priceString: string,
  price: number,
): PackageLike {
  return {
    identifier,
    packageType: 'CUSTOM',
    product: { identifier: productId, price, priceString, currencyCode: 'INR' },
  };
}

const OFFERING: OfferingLike = {
  identifier: 'default',
  availablePackages: [
    // A leftover Plus package, listed first on purpose: it must never become the Pro card.
    pkg('plus_monthly', 'waves_plus_monthly:monthly', '₹49.00', 49),
    pkg('pro_monthly', 'waves_pro_monthly', '₹79.00', 79),
  ],
};

describe('planCardsFromOffering', () => {
  it('makes one Pro card with the store’s own price, and skips a retired Plus package', () => {
    expect(planCardsFromOffering(OFFERING, 'monthly')).toEqual([
      {
        tier: PlanTier.Pro,
        period: 'monthly',
        packageId: 'pro_monthly',
        productId: 'waves_pro_monthly',
        priceString: '₹79.00',
        price: 79,
        currency: 'INR',
      },
    ]);
  });

  it('has no cards for a period the offering does not sell, or no offering', () => {
    expect(planCardsFromOffering(OFFERING, 'yearly')).toEqual([]);
    expect(planCardsFromOffering(null, 'monthly')).toEqual([]);
    expect(periodsInOffering(OFFERING)).toEqual(['monthly']);
    expect(periodsInOffering(undefined)).toEqual([]);
  });

  it('picks up annual packages once they exist, by package type or id', () => {
    const withAnnual: OfferingLike = {
      identifier: 'default',
      availablePackages: [
        ...OFFERING.availablePackages,
        { ...pkg('$rc_annual', 'waves_pro_yearly', '₹699.00', 699), packageType: 'ANNUAL' },
      ],
    };
    expect(periodsInOffering(withAnnual)).toEqual(['monthly', 'yearly']);
    expect(planCardsFromOffering(withAnnual, 'yearly').map((c) => c.packageId)).toEqual([
      '$rc_annual',
    ]);
    // ...or by a custom package id.
    const custom: OfferingLike = {
      identifier: 'default',
      availablePackages: [pkg('pro_annual', 'waves_pro_y', '₹699.00', 699)],
    };
    expect(planCardsFromOffering(custom, 'yearly').map((c) => c.packageId)).toEqual(['pro_annual']);
  });

  it('ignores a package for a product Waves does not sell', () => {
    const odd = pkg('tip_jar', 'waves_tip', '₹10.00', 10);
    expect(tierOfPackage(odd)).toBeNull();
    expect(periodOfPackage({ ...odd, packageType: 'MONTHLY' })).toBe('monthly');
    expect(planCardsFromOffering({ identifier: 'x', availablePackages: [odd] }, 'monthly')).toEqual(
      [],
    );
  });
});

describe('tierFromCustomerInfo', () => {
  const info = (active: Record<string, { isActive?: boolean; productIdentifier?: string }>) => ({
    entitlements: { active },
  });

  it('is free with nothing active, or no info at all', () => {
    expect(tierFromCustomerInfo(null)).toBe(PlanTier.Free);
    expect(tierFromCustomerInfo(info({}))).toBe(PlanTier.Free);
  });

  it('is Pro for the pro entitlement, and for the retired plus one', () => {
    expect(tierFromCustomerInfo(info({ plus: { isActive: true } }))).toBe(PlanTier.Pro);
    expect(tierFromCustomerInfo(info({ pro: { isActive: true } }))).toBe(PlanTier.Pro);
    expect(tierFromCustomerInfo(info({ plus: { isActive: true }, pro: { isActive: true } }))).toBe(
      PlanTier.Pro,
    );
    expect(tierFromCustomerInfo(info({ pro: { isActive: false } }))).toBe(PlanTier.Free);
  });

  it('names the product behind the active entitlement, without a Play base plan', () => {
    expect(
      activeProductId(info({ plus: { productIdentifier: 'waves_plus_monthly:monthly' } })),
    ).toBe('waves_plus_monthly');
    expect(activeProductId(info({}))).toBeNull();
  });
});

describe('revenueCatApiKey', () => {
  it('uses the platform’s key and treats a blank one as none', () => {
    const env = { ios: 'appl_abc', android: ' goog_xyz ' };
    expect(revenueCatApiKey('ios', env, false)).toBe('appl_abc');
    expect(revenueCatApiKey('android', env, false)).toBe('goog_xyz');
    expect(revenueCatApiKey('web', env, false)).toBeNull();
    expect(revenueCatApiKey('ios', { ios: '  ' }, false)).toBeNull();
    expect(revenueCatApiKey('android', {}, false)).toBeNull();
  });

  it('uses a Test Store key only in a development build', () => {
    const env = { ios: 'test_abc', android: 'test_abc' };
    expect(revenueCatApiKey('ios', env, true)).toBe('test_abc');
    expect(revenueCatApiKey('android', env, false)).toBeNull();
  });
});

describe('yearlySavingsPercent', () => {
  it('compares a year against twelve months', () => {
    expect(yearlySavingsPercent(79, 699)).toBe(26);
    expect(yearlySavingsPercent(49, 429)).toBe(27);
    expect(yearlySavingsPercent(0, 490)).toBe(0);
    expect(yearlySavingsPercent(49, 999)).toBe(0);
  });
});

describe('paywall presentation', () => {
  const cards = [{ tier: PlanTier.Pro }] as unknown as Parameters<typeof chosenCard>[0];

  it('starts on Pro', () => {
    expect(defaultSelectedTier()).toBe(PlanTier.Pro);
  });
  it('falls back to the last card when the selected tier has none', () => {
    expect(chosenCard(cards, PlanTier.Pro)?.tier).toBe(PlanTier.Pro);
    expect(chosenCard([], PlanTier.Pro)).toBeUndefined();
  });
  it('disables the button for the current plan, while buying and with no card', () => {
    const pro = { tier: PlanTier.Pro as PaidTier };
    expect(ctaState({ chosen: pro, current: PlanTier.Free, purchasing: false })).toEqual({
      kind: 'continue',
      disabled: false,
    });
    expect(ctaState({ chosen: pro, current: PlanTier.Pro, purchasing: false })).toEqual({
      kind: 'current',
      disabled: true,
    });
    expect(ctaState({ chosen: pro, current: PlanTier.Free, purchasing: true })).toEqual({
      kind: 'busy',
      disabled: true,
    });
    expect(
      ctaState({ chosen: undefined, current: PlanTier.Free, purchasing: false }).disabled,
    ).toBe(true);
  });
  it('shows the upgrade hero except for Pro', () => {
    expect(showUpgradeHero(PlanTier.Free)).toBe(true);
    expect(showUpgradeHero(PlanTier.Pro)).toBe(false);
  });
  it('blames the network only when loading failed', () => {
    expect(paywallEmptyReason(true)).toBe('network');
    expect(paywallEmptyReason(false)).toBe('no-plans');
  });
});

describe('selectOffering', () => {
  const offering = (identifier: string) => ({ identifier, availablePackages: [] });
  const all = { default: offering('default'), other: offering('other') };

  it('is the current offering, else default, else nothing', () => {
    expect(selectOffering({ current: all.other, all })).toBe(all.other);
    expect(selectOffering({ current: null, all })).toBe(all.default);
    expect(selectOffering({ current: null, all: {} })).toBeNull();
  });
});
