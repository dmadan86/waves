import type { Href } from 'expo-router';

import { router } from '@/lib/navigation';

export type PlanningSegment = 'recurring' | 'budgets' | 'loans';

/** The three screens behind the Planning tab's Recurring | Budgets | Loans switch. */
export const PLANNING_ROUTE = {
  recurring: '/personal/recurring',
  budgets: '/personal/budgets',
  loans: '/personal/loans',
} as const satisfies Record<PlanningSegment, string>;

/** The href of a Planning segment; `params` pre-fill it (e.g. a budget's category). */
export function planningHref(segment: PlanningSegment, params?: Record<string, string>): Href {
  const pathname = PLANNING_ROUTE[segment];
  return params && Object.keys(params).length > 0 ? { pathname, params } : pathname;
}

/**
 * Every in-app link to Recurring, Budgets or Loans goes through here, so they all land on the
 * Planning tab (no back button, Planning highlighted, switch visible) like the bottom bar does.
 * Single budgets/loans, forms and Rentals stay ordinary pushes.
 */
export function openPlanning(segment: PlanningSegment, params?: Record<string, string>): void {
  router.navigate(planningHref(segment, params));
}
