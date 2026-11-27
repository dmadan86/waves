/**
 * Icons for the step-by-step wizards: one per step and one per tap-to-pick
 * answer, kept here so a new option cannot ship without one (see the test).
 */
import type Ionicons from '@expo/vector-icons/Ionicons';

import type { InvestmentType, PropertyType } from '@waves/core';

export type IconName = keyof typeof Ionicons.glyphMap;

export const PROPERTY_ICON: Record<PropertyType, IconName> = {
  house: 'home-outline',
  apartment: 'business-outline',
  room: 'bed-outline',
  shop: 'storefront-outline',
  commercial: 'storefront-outline',
  land: 'map-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

export const INVESTMENT_ICON: Record<InvestmentType, IconName> = {
  fund: 'stats-chart-outline',
  stocks: 'trending-up-outline',
  deposit: 'lock-closed-outline',
  retirement: 'umbrella-outline',
  metals: 'diamond-outline',
  bonds: 'document-text-outline',
  insurance_linked: 'shield-checkmark-outline',
  crypto: 'logo-bitcoin',
  savings_group: 'people-outline',
  property: 'home-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

export const YES_NO_ICON: Record<'yes' | 'no', IconName> = {
  yes: 'checkmark-circle-outline',
  no: 'close-circle-outline',
};

/** Personal setup answers. */
export const INCOME_ICON = {
  salary: 'briefcase-outline',
  business: 'storefront-outline',
  freelance: 'laptop-outline',
  pension: 'leaf-outline',
  none: 'close-circle-outline',
} as const satisfies Record<string, IconName>;

export const HOME_ICON = {
  rent: 'key-outline',
  home_loan: 'home-outline',
  none: 'close-circle-outline',
} as const satisfies Record<string, IconName>;

export const LOAN_ICON = {
  car: 'car-outline',
  personal: 'person-outline',
  secured_other: 'diamond-outline',
  education: 'school-outline',
  card: 'card-outline',
} as const satisfies Record<string, IconName>;

export const EAT_ICON = {
  rarely: 'leaf-outline',
  week12: 'cafe-outline',
  week34: 'restaurant-outline',
  daily: 'fast-food-outline',
} as const satisfies Record<string, IconName>;

export const SAVINGS_ICON = {
  none: 'remove-circle-outline',
  under1: 'wallet-outline',
  '1to3': 'cash-outline',
  '3to6': 'trending-up-outline',
  '6plus': 'trophy-outline',
} as const satisfies Record<string, IconName>;

/** Tenant-flow answers (the yearly increase). */
export const ESCALATION_ICON: IconName = 'trending-up-outline';
export const EATEN_EACH_ICON: IconName = 'cash-outline';

/** The header icon of each step. */
export const STEP_ICON = {
  propType: 'home-outline',
  propName: 'pricetag-outline',
  rented: 'key-outline',
  tenant: 'person-outline',
  rent: 'cash-outline',
  day: 'calendar-outline',
  deposit: 'wallet-outline',
  dates: 'calendar-number-outline',
  escalation: 'trending-up-outline',
  invType: 'stats-chart-outline',
  payout: 'shield-checkmark-outline',
  invName: 'pricetag-outline',
  invHowMuch: 'cash-outline',
  invAuto: 'repeat-outline',
  invOpening: 'wallet-outline',
  invValue: 'trending-up-outline',
  income: 'cash-outline',
  home: 'home-outline',
  bills: 'receipt-outline',
  emi: 'card-outline',
  eatOut: 'restaurant-outline',
  savings: 'wallet-outline',
  cap: 'speedometer-outline',
} as const satisfies Record<string, IconName>;

/** Tiles when every option carries an icon, chips otherwise. */
export const usesTiles = (options: readonly { icon?: IconName }[]): boolean =>
  options.length > 0 && options.every((o) => o.icon !== undefined);
