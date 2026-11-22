import { useMemo } from 'react';

import type { OverflowMenuItem } from '@/components/OverflowMenu';
import { useGroups } from '@/data/hooks';
import { groupLabel } from '@/data/types';
import { router, switchTab } from '@/lib/navigation';

/** The shared Personal/Shared switcher rows, in the order groups arrive. */
export function useSpaceSwitchItems(
  current: 'shared' | 'personal',
  labels: { shared: string; personal: string },
) {
  const groups = useGroups();
  const shared = current === 'shared';

  return useMemo<OverflowMenuItem[]>(() => {
    const personalItem: OverflowMenuItem = {
      icon: shared ? 'people-outline' : 'checkmark',
      label: labels.personal,
      onPress: shared ? () => switchTab('/(tabs)/me') : () => undefined,
    };
    const sharedItem: OverflowMenuItem = {
      icon: shared ? 'checkmark' : 'people-outline',
      label: labels.shared,
      onPress: shared ? () => undefined : () => switchTab('/'),
    };
    const groupItems: OverflowMenuItem[] = (groups.data ?? [])
      .filter((group) => group.type === 'couple' || group.type === 'home')
      .map((group) => ({
        icon: (group.type === 'couple'
          ? 'heart-outline'
          : 'home-outline') as OverflowMenuItem['icon'],
        label: groupLabel(group),
        onPress: () => router.push(`/group/${group.id}`),
      }));

    return shared
      ? [sharedItem, personalItem, ...groupItems]
      : [personalItem, ...groupItems, sharedItem];
  }, [groups.data, labels.personal, labels.shared, shared]);
}
