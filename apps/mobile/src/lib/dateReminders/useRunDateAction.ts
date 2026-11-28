import type { UpcomingItem } from '@waves/core';

import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { openPlanning } from '@/lib/openPlanning';

import { actionFor, giftCollectionRoute } from './actions';

/** Runs the one action a date offers (gift collection, budget, pay). */
export function useRunDateAction(): (item: UpcomingItem) => void {
  const { t } = useStrings();
  return (item) => {
    const action = actionFor(item);
    if (!action) return;
    if (action === 'giftCollection')
      router.push(giftCollectionRoute(fill(t.dates.giftGroupName, { name: item.name })));
    // No /personal/setup on this branch: recurring rules are where pay lives.
    else openPlanning(action === 'updatePay' ? 'recurring' : 'budgets');
  };
}
