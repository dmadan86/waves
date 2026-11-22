import { useMemo } from 'react';

import type { OverflowMenuItem } from '@/components/OverflowMenu';
import { useGroups, useHomeSummary } from '@/data/hooks';
import { groupLabel } from '@/data/types';
import { useViewerId } from '@/lib/auth';
import { router, switchTab } from '@/lib/navigation';
import { buildSpaceSwitchItems } from '@/lib/spaceSwitchItems';

/** The shared Personal/Shared switcher rows, in the order groups arrive. */
export function useSpaceSwitchItems(
  current: 'shared' | 'personal',
  labels: { shared: string; personal: string },
) {
  const groups = useGroups();
  const viewerId = useViewerId();
  const summary = useHomeSummary(viewerId);
  const shared = current === 'shared';

  return useMemo<OverflowMenuItem[]>(
    () =>
      buildSpaceSwitchItems({
        shared,
        labels: { shared: labels.shared, personal: labels.personal },
        groups: groups.data ?? [],
        groupLabel: (group) =>
          groupLabel(
            groups.data?.find((g) => g.id === group.id),
            summary.membersFor(group.id),
            viewerId,
          ),
        goPersonal: () => switchTab('/(tabs)/me'),
        goShared: () => switchTab('/'),
        openGroup: (id) => router.push(`/group/${id}`),
      }),
    [groups.data, labels.personal, labels.shared, shared, summary, viewerId],
  );
}
