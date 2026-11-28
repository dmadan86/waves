/** Remind / Mark received for one tenancy, through the same writes the property page uses. */

import { Share } from 'react-native';

import { useWealthWrites } from '@/data/personalWealth';
import { fill, useStrings } from '@/i18n';
import { hapticSuccess } from '@/lib/assistantHaptics';
import type { RentItem } from '@/lib/calm/rentDue';

export function useRentActions(space: string | undefined, today: string) {
  const writes = useWealthWrites(space);
  const { t, locale } = useStrings();
  return {
    /** "Yes, received": what is still owed on the oldest unpaid due, recorded as of today. */
    markReceived: (item: RentItem): void => {
      void writes
        .recordRent(item.rule, item.propertyId, item.amount, today, item.unit, item.full)
        .then(hapticSuccess, () => {});
    },
    /** The person's own share sheet, with a polite note to send the tenant. */
    remind: (item: RentItem, amountText: string): void => {
      const date = new Date(`${item.dueDate}T12:00:00`).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
      });
      void Share.share({
        message: fill(t.calm.remindMessage, {
          tenant: item.tenant,
          amount: amountText,
          unit: item.unit,
          date,
        }),
      }).catch(() => {});
    },
  };
}
