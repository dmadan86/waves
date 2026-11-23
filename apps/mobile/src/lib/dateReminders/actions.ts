import type { Href } from 'expo-router';
import type { UpcomingItem } from '@waves/core';

export type DateAction = 'giftCollection' | 'setBudget' | 'updatePay' | 'planBudget';

/** The single action a date offers, or null (my own birthday). */
export function actionFor(item: UpcomingItem): DateAction | null {
  switch (item.kind) {
    case 'my_birthday':
      return null;
    case 'family_birthday':
      return 'giftCollection';
    case 'work_anniversary':
      return 'updatePay';
    case 'festival':
      return 'planBudget';
    default:
      return 'setBudget';
  }
}

/** Where the action goes. `giftName` is the localised "<Name>'s birthday gift". */
export function routeForAction(action: DateAction, giftName: string): Href {
  switch (action) {
    case 'giftCollection':
      return {
        pathname: '/new-group',
        params: { type: 'event', template: 'birthday', name: giftName },
      };
    case 'updatePay':
      // No /personal/setup on this branch: recurring rules are where pay lives.
      return '/personal/recurring';
    default:
      return '/personal/budgets';
  }
}
