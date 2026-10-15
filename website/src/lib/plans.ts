/**
 * What the paid plans cost in India, in rupees. These mirror the store
 * products documented in docs/pricing.md (`waves_plus_monthly` ₹49,
 * `waves_pro_monthly` ₹99) and the yearly prices set for launch (₹499, ₹999).
 * Other markets are priced in the stores themselves, so the page says so rather
 * than converting a number here.
 */
export const plans = {
  plus: { monthly: 49, yearly: 499 },
  pro: { monthly: 99, yearly: 999 },
} as const;

export type PlanId = keyof typeof plans;

/** The saving of paying yearly rather than twelve months, as a whole percent. */
export function yearlySavingPercent(id: PlanId): number {
  const { monthly, yearly } = plans[id];
  return Math.round((1 - yearly / (monthly * 12)) * 100);
}

/** The best saving on offer, for the toggle's "Save up to N%" label. */
export const bestYearlySaving = Math.max(yearlySavingPercent('plus'), yearlySavingPercent('pro'));
