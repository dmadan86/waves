import { useMemo } from 'react';

import { useGroups } from '@/data/hooks';
import { isHouseholdMode } from '@/lib/householdTab';

/** True while a household group's screens are open (from the local mirror, no network). */
export function useHouseholdMode(segments: readonly string[], groupId: string | null): boolean {
  const groups = useGroups().data;
  return useMemo(
    () =>
      isHouseholdMode(
        segments,
        groupId,
        groupId ? groups?.find((g) => g.id === groupId) : undefined,
      ),
    [segments, groupId, groups],
  );
}
