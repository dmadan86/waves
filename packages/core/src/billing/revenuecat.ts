/**
 * The names RevenueCat, the two stores and Waves all have to agree on.
 *
 * RevenueCat sits between the stores and Waves: the app buys through it, and
 * its webhook (`supabase/functions/revenuecat-webhook`) writes the result into
 * `subscriptions`, which is what the server trusts. Both sides read the ids
 * from here so a product renamed in one place cannot quietly grant the wrong
 * tier in the other.
 *
 * Tiers: **Plus** is the paid features without the advanced voice agent; **Pro**
 * is everything. A person holding both entitlements is Pro.
 */

import { PlanTier } from './plans';

/** RevenueCat entitlement identifiers (Project → Entitlements). */
export const RC_ENTITLEMENT_PLUS = 'plus';
export const RC_ENTITLEMENT_PRO = 'pro';

/** The offering the paywall shows (Project → Offerings, marked current). */
export const RC_DEFAULT_OFFERING = 'default';

/**
 * Store product ids. Same id on both stores: an App Store auto-renewable
 * subscription, and a Play subscription whose base plan RevenueCat reports as
 * `<productId>:<basePlanId>` (the suffix is stripped before matching).
 */
export const RC_PRODUCT_IDS = {
  plusMonthly: 'waves_plus_monthly',
  plusYearly: 'waves_plus_yearly',
  proMonthly: 'waves_pro_monthly',
  proYearly: 'waves_pro_yearly',
} as const;

/** `waves_pro_monthly:monthly` → `waves_pro_monthly`. */
export function baseProductId(productId: string): string {
  const colon = productId.indexOf(':');
  return (colon === -1 ? productId : productId.slice(0, colon)).trim().toLowerCase();
}

/** The highest tier a set of active entitlement ids grants. */
export function tierFromEntitlementIds(ids: readonly string[] | null | undefined): PlanTier {
  const set = new Set((ids ?? []).map((id) => id.trim().toLowerCase()));
  if (set.has(RC_ENTITLEMENT_PRO)) return PlanTier.Pro;
  if (set.has(RC_ENTITLEMENT_PLUS)) return PlanTier.Plus;
  return PlanTier.Free;
}

/**
 * The tier a product id sells, or null for one Waves does not recognise.
 * Matches on a whole `pro` / `plus` word, so `waves_pro_monthly` and
 * `waves_plus_yearly:annual` both resolve and `waves_promo` does not.
 */
export function tierFromProductId(productId: string | null | undefined): PlanTier | null {
  if (!productId) return null;
  const words = baseProductId(productId).split(/[^a-z0-9]+/);
  if (words.includes('pro')) return PlanTier.Pro;
  if (words.includes('plus')) return PlanTier.Plus;
  return null;
}

/** 'monthly' / 'yearly' from a product id, or null when it does not say. */
export function periodFromProductId(
  productId: string | null | undefined,
): 'monthly' | 'yearly' | null {
  if (!productId) return null;
  const words = productId.toLowerCase().split(/[^a-z0-9]+/);
  if (words.some((w) => w === 'yearly' || w === 'annual' || w === 'year' || w === 'p1y')) {
    return 'yearly';
  }
  if (words.some((w) => w === 'monthly' || w === 'month' || w === 'p1m')) return 'monthly';
  return null;
}
