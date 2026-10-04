/**
 * The pure arithmetic and the fallback price table behind the paywall.
 *
 * Nothing here talks to the store. `paywall.tsx` fetches the real, localized
 * prices at runtime and feeds the numbers it gets back through
 * `monthlyEquivalent` / `freeMonthsForYearly` — the charged price itself is
 * never hardcoded. The table below exists only for the screen that cannot
 * reach the store at all (a dev build with no Play/App Store session, a
 * simulator, a network blip): it is what the paywall shows, clearly marked
 * "approximate", while it waits for or fails to get the real thing. Treat
 * every number in it as an introductory price the owner may change — not a
 * contract — and never let it feed a receipt.
 */

import type { CurrencyCode } from '@waves/core';

/** The two things Waves sells, and the store product id behind each. */
export type ProPlanId = 'monthly' | 'yearly';

export const MONTHLY_PRODUCT_ID = 'waves_pro_monthly';
export const YEARLY_PRODUCT_ID = 'waves_pro_yearly';

/**
 * One subscription product per plan, on both stores, rather than one
 * subscription with two base plans (Android's model).
 *
 * Android's "base plans" have no equivalent on the App Store — there, every
 * price point is its own product, grouped only by a Subscription Group. Two
 * flat product ids keep the two stores symmetric and let a single
 * `fetchProducts({ skus, type: 'subs' })` call return both: Play Console
 * holds `waves_pro_monthly` and `waves_pro_yearly` as two subscriptions (one
 * base plan each) inside one app, and App Store Connect holds them as two
 * auto-renewable subscriptions in one Subscription Group. See docs/pricing.md.
 */
export const PRO_PRODUCT_IDS: Readonly<Record<ProPlanId, string>> = {
  monthly: MONTHLY_PRODUCT_ID,
  yearly: YEARLY_PRODUCT_ID,
};

/** The free-trial length on the yearly plan. Fixed by the pricing model, not
 *  read from the store — both stores are configured to offer exactly this. */
export const YEARLY_TRIAL_DAYS = 7;

/** Which plan a store product id names, or null for anything else. */
export function planForProductId(productId: string | null | undefined): ProPlanId | null {
  if (productId === MONTHLY_PRODUCT_ID) return 'monthly';
  if (productId === YEARLY_PRODUCT_ID) return 'yearly';
  return null;
}

/** A plan's price as plain numbers, for the fallback table and for whatever
 *  the store itself hands back — never used for a receipt, only for display
 *  and for the "2 months free" / per-month arithmetic below. */
export interface FallbackPrice {
  currency: CurrencyCode;
  monthly: number;
  yearly: number;
}

type FallbackRegion = 'US' | 'UK' | 'AU' | 'GULF' | 'IN';

/**
 * The owner's decided introductory prices (2026), kept only as the
 * last-resort display when the store cannot be reached. Mirrors
 * docs/pricing.md — update both together.
 */
const FALLBACK_PRICES: Readonly<Record<FallbackRegion, FallbackPrice>> = {
  US: { currency: 'USD', monthly: 0.99, yearly: 9.99 },
  UK: { currency: 'GBP', monthly: 0.99, yearly: 9.99 },
  AU: { currency: 'AUD', monthly: 1.49, yearly: 14.99 },
  GULF: { currency: 'AED', monthly: 3.99, yearly: 39.99 },
  IN: { currency: 'INR', monthly: 39, yearly: 399 },
};

/** The Gulf countries the AED fallback price covers — UAE and its neighbours,
 *  per the pricing model ("UAE/Gulf"), not UAE alone. */
const GULF_COUNTRIES: ReadonlySet<string> = new Set(['AE', 'SA', 'QA', 'KW', 'BH', 'OM']);

/**
 * Which fallback price applies to a country, defaulting to the US price.
 *
 * Unlike `deviceDefaultCurrency` (which falls back to INR — Waves' first
 * market), this falls back to the US row deliberately: the owner's price
 * list anchors on USD for "everywhere else", and a paywall that cannot reach
 * the store has no country-specific information to prefer INR with.
 */
export function fallbackRegionForCountry(countryCode: string | null | undefined): FallbackRegion {
  const country = (countryCode ?? '').trim().toUpperCase();
  if (country === 'GB') return 'UK';
  if (country === 'AU') return 'AU';
  if (country === 'IN') return 'IN';
  if (GULF_COUNTRIES.has(country)) return 'GULF';
  return 'US';
}

/** The fallback price to show for this country, approximate by definition. */
export function fallbackPriceFor(countryCode: string | null | undefined): FallbackPrice {
  return FALLBACK_PRICES[fallbackRegionForCountry(countryCode)];
}

/** The yearly plan's price spread evenly across its 12 months — what "$0.83
 *  / month" means next to the yearly card. Division only; the caller formats. */
export function monthlyEquivalent(yearlyPrice: number): number {
  return yearlyPrice / 12;
}

/** How many of the yearly plan's 12 months are effectively free compared with
 *  paying the monthly price every month, rounded to the nearest whole month.
 *  The pricing model targets 2; this recomputes it from whatever price the
 *  store actually charges rather than assuming the target was hit exactly. */
export function freeMonthsForYearly(monthlyPrice: number, yearlyPrice: number): number {
  if (!(monthlyPrice > 0)) return 0;
  const monthsPaidFor = yearlyPrice / monthlyPrice;
  return Math.max(0, Math.round(12 - monthsPaidFor));
}

/** The yearly plan's saving over paying monthly for 12 months, as a whole
 *  percent. `freeMonthsForYearly` is what the badge says; this is the number
 *  behind it, for copy that wants a percentage instead of a month count. */
export function yearlySavingsPercent(monthlyPrice: number, yearlyPrice: number): number {
  if (!(monthlyPrice > 0)) return 0;
  const fullYearAtMonthly = monthlyPrice * 12;
  const savings = 1 - yearlyPrice / fullYearAtMonthly;
  return Math.max(0, Math.round(savings * 100));
}

/**
 * Format a plain number as money for display only — never for a receipt, and
 * never fed back into arithmetic (same rule as `@waves/core`'s own
 * `format()`, which this cannot use directly: that one takes integer minor
 * units for a currency Waves already models, and a store's numeric price —
 * or the fallback table above — is a float in whatever currency the storefront
 * or the owner's list named, including ones `@waves/core` has no opinion on).
 */
export function formatApproxMoney(amount: number, currency: string, locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** What owning a plan looks like, read off the store's own active
 *  subscriptions rather than anything Waves wrote down. */
export interface Entitlement {
  isPro: boolean;
  plan: ProPlanId | null;
  /** Known only on iOS today — see `useEntitlement`'s doc comment. */
  expiry: Date | null;
}

/** The minimal shape `entitlementFromActiveSubscriptions` needs from
 *  expo-iap's `ActiveSubscription` — spelled out locally so this file stays
 *  free of a runtime import from a native module. */
export interface ActiveSubscriptionLike {
  productId: string;
  isActive: boolean;
  expirationDateIOS?: number | null;
}

/**
 * Derive the entitlement the paywall and `useEntitlement` both show, from
 * whatever `useIAP()`'s `activeSubscriptions` currently holds.
 *
 * Pure on purpose: it is what lets the paywall screen compute its own
 * "already subscribed" state from its own single `useIAP()` call instead of
 * also mounting `useEntitlement`, which would open a second store
 * connection — see `useEntitlement`'s doc comment for why that matters.
 */
export function entitlementFromActiveSubscriptions(
  activeSubscriptions: readonly ActiveSubscriptionLike[],
): Entitlement {
  const active = activeSubscriptions.find(
    (sub) => sub.isActive && planForProductId(sub.productId) !== null,
  );
  if (!active) return { isPro: false, plan: null, expiry: null };
  return {
    isPro: true,
    plan: planForProductId(active.productId),
    expiry: active.expirationDateIOS != null ? new Date(active.expirationDateIOS) : null,
  };
}
