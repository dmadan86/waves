import type { UpcomingItem } from '@waves/core';

import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

import { actionFor, routeForAction } from './actions';

/** Runs the one action a date offers (gift collection, budget, pay). */
export function useRunDateAction(): (item: UpcomingItem) => void {
  const { t } = useStrings();
  return (item) => {
    const action = actionFor(item);
    if (action)
      router.push(routeForAction(action, fill(t.dates.giftGroupName, { name: item.name })));
  };
}
