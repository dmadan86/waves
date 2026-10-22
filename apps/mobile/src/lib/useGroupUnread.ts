/**
 * The React side of `lib/groupUnread`: which of the listed groups wear the
 * unread dot, and the mark a group screen makes when it is opened. Kept apart
 * from the pure rules so their tests never load the sync layer.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';

import { useNewestActivityFromOthersByGroup } from '@/data/hooks';
import { useViewerId } from '@/lib/auth';
import {
  beginGroupVisit,
  markGroupSeen,
  seedGroupsSeen,
  subscribeGroupsSeen,
  unreadGroupIds,
  useGroupsSeen,
  visitBaseline,
} from '@/lib/groupUnread';

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
  // The visit opens before the focus effect below marks the group, so the mark
  // can keep the last look it replaces (see `useGroupBaseline`).
  useEffect(() => beginGroupVisit(viewerId, groupId), [viewerId, groupId]);
  const newestByGroup = useNewestActivityFromOthersByGroup(viewerId);
  const newest = groupId ? (newestByGroup.get(groupId) ?? 0) : 0;
  useFocusEffect(
    useCallback(() => {
      if (groupId) markGroupSeen(viewerId, groupId, Math.max(Date.now(), newest));
    }, [viewerId, groupId, newest]),
  );
}

/**
 * When the reader last opened `groupId` *before this visit* — what "new" is
 * measured from. Fixed for the visit, so the highlight survives the group
 * marking itself seen, and survives opening an expense and coming back. Outside
 * a visit (an expense opened from Activity or a notification) it is the stored
 * last look, which is still the previous one as long as the group was not
 * opened since. Null while unknown, which marks nothing.
 */
export function useGroupBaseline(groupId: string | null): number | null {
  const viewerId = useViewerId();
  const seen = useGroupsSeen(viewerId);
  const visit = useSyncExternalStore(
    subscribeGroupsSeen,
    () => visitBaseline(viewerId, groupId),
    () => visitBaseline(viewerId, groupId),
  );
  if (visit !== null) return visit;
  return groupId && seen ? (seen[groupId] ?? null) : null;
}
