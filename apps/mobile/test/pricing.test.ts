/**
 * The pure logic behind the paywall: RevenueCat offering → plan cards and
 * CustomerInfo → tier. No React, no store, no native module — see
 * src/lib/pricing.ts.
 */

import { describe, expect, it } from 'vitest';

import { PlanTier } from '@waves/core';

import {
  activeProductId,
  periodOfPackage,
  periodsInOffering,
  planCardsFromOffering,
  revenueCatApiKey,
  tierFromCustomerInfo,
  tierOfPackage,
  yearlySavingsPercent,
  type OfferingLike,
  type PackageLike,
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
    // Out of order on purpose: the cards must still come out Plus, then Pro.
    pkg('pro_monthly', 'waves_pro_monthly', '₹99.00', 99),
    pkg('plus_monthly', 'waves_plus_monthly:monthly', '₹49.00', 49),
  ],
};

describe('planCardsFromOffering', () => {
  it('makes a Plus card then a Pro card with the store’s own prices', () => {
    expect(planCardsFromOffering(OFFERING, 'monthly')).toEqual([
      {
        tier: PlanTier.Plus,
        period: 'monthly',
        packageId: 'plus_monthly',
        productId: 'waves_plus_monthly:monthly',
        priceString: '₹49.00',
        price: 49,
        currency: 'INR',
      },
      {
        tier: PlanTier.Pro,
        period: 'monthly',
        packageId: 'pro_monthly',
        productId: 'waves_pro_monthly',
        priceString: '₹99.00',
        price: 99,
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
        { ...pkg('$rc_annual', 'waves_plus_yearly', '₹499.00', 499), packageType: 'ANNUAL' },
        pkg('pro_annual', 'waves_pro_y', '₹999.00', 999),
      ],
    };
    expect(periodsInOffering(withAnnual)).toEqual(['monthly', 'yearly']);
    expect(planCardsFromOffering(withAnnual, 'yearly').map((c) => c.packageId)).toEqual([
      '$rc_annual',
      'pro_annual',
    ]);
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

  it('is Plus for the plus entitlement and Pro whenever pro is active', () => {
    expect(tierFromCustomerInfo(info({ plus: { isActive: true } }))).toBe(PlanTier.Plus);
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
    expect(revenueCatApiKey('ios', env)).toBe('appl_abc');
    expect(revenueCatApiKey('android', env)).toBe('goog_xyz');
    expect(revenueCatApiKey('web', env)).toBeNull();
    expect(revenueCatApiKey('ios', { ios: '  ' })).toBeNull();
    expect(revenueCatApiKey('android', {})).toBeNull();
  });
});

describe('yearlySavingsPercent', () => {
  it('compares a year against twelve months', () => {
    expect(yearlySavingsPercent(49, 490)).toBe(17);
    expect(yearlySavingsPercent(0, 490)).toBe(0);
    expect(yearlySavingsPercent(49, 999)).toBe(0);
  });
});
