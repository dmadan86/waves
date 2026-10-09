/**
 * The React side of `lib/groupUnread`: which of the listed groups wear the
 * unread dot, and the mark a group screen makes when it is opened. Kept apart
 * from the pure rules so their tests never load the sync layer.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';

import { useNewestActivityFromOthersByGroup } from '@/data/hooks';
import { useViewerId } from '@/lib/auth';
import { markGroupSeen, seedGroupsSeen, unreadGroupIds, useGroupsSeen } from '@/lib/groupUnread';

/**
 * The ids among `groupIds` with news from someone else since the reader last
 * opened them. Empty until the stored reads have loaded (no flash at launch),
 * and any group never recorded is seeded as read now, so a first run starts
 * quiet rather than with a dot on every row.
 */
export function useGroupUnread(groupIds: readonly string[]): ReadonlySet<string> {
  const viewerId = useViewerId();
  const newestByGroup = useNewestActivityFromOthersByGroup(viewerId);
  const seen = useGroupsSeen(viewerId);

  useEffect(() => {
    if (seen) seedGroupsSeen(viewerId, groupIds, newestByGroup, Date.now());
  }, [seen, viewerId, groupIds, newestByGroup]);

  return useMemo(
    () => unreadGroupIds(groupIds, newestByGroup, seen),
    [groupIds, newestByGroup, seen],
  );
}

/**
 * Marks `groupId` read while its screen is in focus — and again as rows arrive
 * while it is open, so news the reader watched land does not light the dot the
 * moment they leave. Up to its newest row or now, whichever is later, so a
 * server clock a little ahead of the phone's cannot leave it lit.
 */
export function useMarkGroupSeen(groupId: string | null): void {
  const viewerId = useViewerId();
  const newestByGroup = useNewestActivityFromOthersByGroup(viewerId);
  const newest = groupId ? (newestByGroup.get(groupId) ?? 0) : 0;
  useFocusEffect(
    useCallback(() => {
      if (groupId) markGroupSeen(viewerId, groupId, Math.max(Date.now(), newest));
    }, [viewerId, groupId, newest]),
  );
}
