/**
 * "Add rate" on a debt that has no rate yet, in a group that settles in its own
 * currency (ADR-003 amendment). Shared by every place that shows one — the
 * Settle up screen, a person's actions — so they all lead to the same fix.
 *
 * The fix is the group's "Add missing rates" card (MissingRatesCard, on the
 * group's settings), which stamps each bill's own rate onto it through the
 * ordinary edit path. A bill the viewer may not rewrite (not its author or a
 * payer) cannot be fixed by them: this says whose it is and offers to open it.
 */

import { useCallback } from 'react';

import { memberLookup, useGroup } from '@/data/hooks';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useDialog } from '@/lib/dialog';
import { activeMemberId } from '@/lib/fxAutoRate';
import { router } from '@/lib/navigation';
import { rateFixFor } from '@/lib/settleCurrency';

export function useAddRate(
  groupId: string,
): (debt: { currency: string; parties: readonly string[] }) => Promise<void> {
  const { t } = useStrings();
  const { confirm } = useDialog();
  const viewerId = useViewerId();
  const { group, members, expenses } = useGroup(groupId);

  return useCallback(
    async ({ currency, parties }) => {
      const groupCurrency = group.data?.default_currency ?? null;
      const fix = groupCurrency
        ? rateFixFor({
            rows: expenses.rows,
            currency,
            groupCurrency,
            myMemberId: activeMemberId(members.data ?? [], viewerId),
            parties,
          })
        : ({ kind: 'settings' } as const);

      switch (fix.kind) {
        case 'backfill':
        case 'settings':
          router.push(`/group/${groupId}/settings`);
          return;
        case 'openBill':
          router.push(`/group/${groupId}/expense/${fix.expenseId}`);
          return;
        case 'notYours': {
          const author = fix.authorId ? memberLookup(members.data).get(fix.authorId) : undefined;
          const name = author ? displayName(author) : t.misc.someone;
          const open = await confirm({
            title: fill(t.fx.rateNotYoursTitle, { name }),
            body: fill(t.fx.rateNotYoursBody, { name }),
            confirmLabel: t.fx.openBill,
            cancelLabel: t.cancel,
          });
          if (open) router.push(`/group/${groupId}/expense/${fix.expenseId}`);
          return;
        }
      }
    },
    [confirm, expenses.rows, group.data, groupId, members.data, t, viewerId],
  );
}
