/**
 * The pure math and fallback lookup behind the paywall: no React, no store,
 * no native module — see src/lib/pricing.ts for why.
 */

import { describe, expect, it } from 'vitest';

import {
  entitlementFromActiveSubscriptions,
  fallbackPriceFor,
  fallbackRegionForCountry,
  formatApproxMoney,
  freeMonthsForYearly,
  monthlyEquivalent,
  planForProductId,
  yearlySavingsPercent,
  MONTHLY_PRODUCT_ID,
  YEARLY_PRODUCT_ID,
} from '../src/lib/pricing';

describe('planForProductId', () => {
  it('names the plan behind each product id', () => {
    expect(planForProductId(MONTHLY_PRODUCT_ID)).toBe('monthly');
    expect(planForProductId(YEARLY_PRODUCT_ID)).toBe('yearly');
  });

  it('is null for anything else, including null and empty input', () => {
    expect(planForProductId('some.other.sku')).toBeNull();
    expect(planForProductId(null)).toBeNull();
    expect(planForProductId(undefined)).toBeNull();
    expect(planForProductId('')).toBeNull();
  });
});

describe('fallbackRegionForCountry / fallbackPriceFor', () => {
  it('maps the five named markets to their own row', () => {
    expect(fallbackRegionForCountry('US')).toBe('US');
    expect(fallbackRegionForCountry('GB')).toBe('UK');
    expect(fallbackRegionForCountry('AU')).toBe('AU');
    expect(fallbackRegionForCountry('IN')).toBe('IN');
    expect(fallbackRegionForCountry('AE')).toBe('GULF');
  });

  it('treats the whole Gulf as one region, not just the UAE', () => {
    for (const country of ['AE', 'SA', 'QA', 'KW', 'BH', 'OM']) {
      expect(fallbackRegionForCountry(country)).toBe('GULF');
    }
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(fallbackRegionForCountry(' in ')).toBe('IN');
    expect(fallbackRegionForCountry('gb')).toBe('UK');
  });

  it('falls back to the US row for anywhere unlisted, and for no country at all', () => {
    expect(fallbackRegionForCountry('DE')).toBe('US');
    expect(fallbackRegionForCountry(null)).toBe('US');
    expect(fallbackRegionForCountry(undefined)).toBe('US');
  });

  it('returns the owner-decided price for each row', () => {
    expect(fallbackPriceFor('US')).toEqual({ currency: 'USD', monthly: 0.99, yearly: 9.99 });
    expect(fallbackPriceFor('GB')).toEqual({ currency: 'GBP', monthly: 0.99, yearly: 9.99 });
    expect(fallbackPriceFor('AU')).toEqual({ currency: 'AUD', monthly: 1.49, yearly: 14.99 });
    expect(fallbackPriceFor('AE')).toEqual({ currency: 'AED', monthly: 3.99, yearly: 39.99 });
    expect(fallbackPriceFor('IN')).toEqual({ currency: 'INR', monthly: 39, yearly: 399 });
  });
});

describe('monthlyEquivalent', () => {
  it('spreads the yearly price across 12 months', () => {
    expect(monthlyEquivalent(9.99)).toBeCloseTo(0.8325, 4);
    expect(monthlyEquivalent(0)).toBe(0);
  });
});

describe('freeMonthsForYearly', () => {
  it('reads ~2 free months off every market in the price list', () => {
    expect(freeMonthsForYearly(0.99, 9.99)).toBe(2);
    expect(freeMonthsForYearly(1.49, 14.99)).toBe(2);
    expect(freeMonthsForYearly(3.99, 39.99)).toBe(2);
    expect(freeMonthsForYearly(39, 399)).toBe(2);
  });

  it('is exactly 2 when the yearly price is exactly 10x the monthly one', () => {
    expect(freeMonthsForYearly(10, 100)).toBe(2);
  });

  it('never goes negative, and is 0 with no usable monthly price', () => {
    expect(freeMonthsForYearly(0, 9.99)).toBe(0);
    expect(freeMonthsForYearly(-1, 9.99)).toBe(0);
    expect(freeMonthsForYearly(1, 1000)).toBe(0);
  });
});

describe('yearlySavingsPercent', () => {
  it('matches the ~17% implied by 2 months free', () => {
    expect(yearlySavingsPercent(0.99, 9.99)).toBe(16);
    expect(yearlySavingsPercent(10, 100)).toBe(17);
  });

  it('is 0 when the yearly price saves nothing, and never negative', () => {
    expect(yearlySavingsPercent(10, 120)).toBe(0);
    expect(yearlySavingsPercent(10, 200)).toBe(0);
  });

  it('is 0 with no usable monthly price', () => {
    expect(yearlySavingsPercent(0, 9.99)).toBe(0);
  });
});

describe('formatApproxMoney', () => {
  it('formats a plain number as that currency, not whatever locale is default', () => {
    expect(formatApproxMoney(9.99, 'USD', 'en-US')).toBe('$9.99');
    expect(formatApproxMoney(399, 'INR', 'en-IN')).toBe('₹399.00');
  });

  it('falls back to a plain "CODE amount" string for a currency Intl rejects', () => {
    expect(formatApproxMoney(9.99, 'NOTACODE', 'en-US')).toBe('NOTACODE 9.99');
  });
});

describe('entitlementFromActiveSubscriptions', () => {
  it('is not pro with no active subscriptions', () => {
    expect(entitlementFromActiveSubscriptions([])).toEqual({
      isPro: false,
      plan: null,
      expiry: null,
    });
  });

  it('ignores a subscription that is not active', () => {
    const result = entitlementFromActiveSubscriptions([
      { productId: YEARLY_PRODUCT_ID, isActive: false },
    ]);
    expect(result.isPro).toBe(false);
  });

  it('ignores an active subscription for a product that is not a Pro plan', () => {
    const result = entitlementFromActiveSubscriptions([
      { productId: 'some.other.sku', isActive: true },
    ]);
    expect(result.isPro).toBe(false);
  });

  it('reports the plan and, on iOS, the expiry of an active Pro subscription', () => {
    const expirationDateIOS = Date.parse('2026-12-01T00:00:00.000Z');
    const result = entitlementFromActiveSubscriptions([
      { productId: MONTHLY_PRODUCT_ID, isActive: true, expirationDateIOS },
    ]);
    expect(result).toEqual({
      isPro: true,
      plan: 'monthly',
      expiry: new Date(expirationDateIOS),
    });
  });

  it('reports the plan with a null expiry when the platform has none (Android)', () => {
    const result = entitlementFromActiveSubscriptions([
      { productId: YEARLY_PRODUCT_ID, isActive: true },
    ]);
    expect(result).toEqual({ isPro: true, plan: 'yearly', expiry: null });
  });
});
