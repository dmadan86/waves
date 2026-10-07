import { describe, expect, it } from 'vitest';

import { isPaidTier, PlanTier, readEntitlement, tierRank } from '../src/billing/plans';
import {
  baseProductId,
  periodFromProductId,
  RC_PRODUCT_IDS,
  tierFromEntitlementIds,
  tierFromProductId,
} from '../src/billing/revenuecat';
import { deviceLimitFor } from '../src/session/devices';

describe('RevenueCat ids', () => {
  it('reads the highest tier from entitlement ids', () => {
    expect(tierFromEntitlementIds([])).toBe(PlanTier.Free);
    expect(tierFromEntitlementIds(null)).toBe(PlanTier.Free);
    expect(tierFromEntitlementIds(['plus'])).toBe(PlanTier.Plus);
    expect(tierFromEntitlementIds(['pro'])).toBe(PlanTier.Pro);
    expect(tierFromEntitlementIds(['plus', 'pro'])).toBe(PlanTier.Pro);
    expect(tierFromEntitlementIds(['premium'])).toBe(PlanTier.Free);
  });

  it('reads the tier and period from a product id, including Play base plans', () => {
    expect(tierFromProductId(RC_PRODUCT_IDS.plusMonthly)).toBe(PlanTier.Plus);
    expect(tierFromProductId(RC_PRODUCT_IDS.proYearly)).toBe(PlanTier.Pro);
    expect(tierFromProductId('waves_pro_monthly:monthly-base')).toBe(PlanTier.Pro);
    expect(tierFromProductId('waves_promo')).toBeNull();
    expect(tierFromProductId(undefined)).toBeNull();
    expect(baseProductId('waves_plus_monthly:base')).toBe('waves_plus_monthly');
    expect(periodFromProductId('waves_plus_monthly')).toBe('monthly');
    expect(periodFromProductId('waves_pro_yearly')).toBe('yearly');
    expect(periodFromProductId('waves_pro:annual')).toBe('yearly');
    expect(periodFromProductId('waves_pro')).toBeNull();
  });
});

describe('Pro', () => {
  it('is paid, ranks above Plus, and gets the paid device limit', () => {
    expect(isPaidTier(PlanTier.Pro)).toBe(true);
    expect(isPaidTier(PlanTier.Plus)).toBe(true);
    expect(isPaidTier(PlanTier.Free)).toBe(false);
    expect(tierRank(PlanTier.Pro)).toBeGreaterThan(tierRank(PlanTier.Plus));
    expect(deviceLimitFor(PlanTier.Pro)).toBe(deviceLimitFor(PlanTier.Plus));
  });

  it('is read from waves_my_plan’s plan key, and from a bare tier', () => {
    expect(readEntitlement({ tier: 'plus', plan: 'pro' }).tier).toBe(PlanTier.Pro);
    expect(readEntitlement({ tier: 'pro' }).tier).toBe(PlanTier.Pro);
    expect(readEntitlement({ tier: 'plus', plan: 'plus' }).tier).toBe(PlanTier.Plus);
    expect(readEntitlement({ tier: 'plus', plan: 'pro' }).source).toBe('subscription');
  });
});
