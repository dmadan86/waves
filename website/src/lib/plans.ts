/**
 * What the plans cost in India, in rupees: Free, and Pro at ₹79 a month or
 * ₹699 a year (about 26% off twelve months). These mirror the store products
 * documented in docs/pricing.md (`waves_pro_monthly`, `waves_pro_yearly`).
 * Other markets are priced in the stores themselves, so the page says so rather
 * than converting a number here.
 */
export const plans = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 79, yearly: 699 },
} as const;

/** Advanced AI voice commands a month (mirrors VOICE_AGENT_*_MONTHLY in packages/core). */
export const voiceCommands = { free: 10, pro: 100 } as const;

/** Days of Pro a new account gets free, with no card (PRO_TRIAL_DAYS in packages/core). */
export const proTrialDays = 15;

export type PlanId = keyof typeof plans;

/** The saving of paying yearly rather than twelve months, as a whole percent. */
export function yearlySavingPercent(id: PlanId): number {
  const { monthly, yearly } = plans[id];
  if (monthly <= 0) return 0;
  return Math.round((1 - yearly / (monthly * 12)) * 100);
}

/** The best saving on offer, for the toggle's "Save up to N%" label. */
export const bestYearlySaving = yearlySavingPercent('pro');
