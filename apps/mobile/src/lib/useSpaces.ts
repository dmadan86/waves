import { useCallback, useEffect } from 'react';
import { useGlobalSearchParams, useSegments } from 'expo-router';

import { useViewerId } from '@/lib/auth';
import { useViewerCompanyIds } from '@/lib/useCompanyTab';
import { router } from '@/lib/navigation';
import {
  coldStartSettled,
  followSpace,
  isHomeTab,
  readLastSpace,
  rememberSpace,
  resolveSpace,
  settleColdStart,
  spaceForRoute,
  takeColdStart,
  type Space,
} from '@/lib/spaces';

/** Remembers the viewer's explicit space switch. */
export function useRememberSpace(): (space: Space) => void {
  const viewerId = useViewerId();
  return useCallback((space) => void rememberSpace(viewerId, space), [viewerId]);
}

/**
 * Cold start: the first time Home is ready, open the remembered company. Deep links never
 * mount Home first, so they are left alone. `ready` waits for the local mirror.
 */
export function useColdStartSpace(ready: boolean, companyIds: readonly string[]): void {
  const viewerId = useViewerId();
  useEffect(() => {
    if (!ready || viewerId === null) return;
    let stale = false;
    void readLastSpace(viewerId).then((stored) => {
      if (stale || !takeColdStart(viewerId)) return;
      const space = resolveSpace(stored, companyIds);
      if (space !== 'personal') router.replace(`/group/${space}`);
    });
    return () => {
      stale = true;
    };
  }, [ready, viewerId, companyIds]);
}

/**
 * The remembered space follows where the viewer actually is: inside a company -> that company,
 * on a Personal tab -> Personal. Neutral screens leave it alone, and a quick pass-through
 * (debounced) does not count. Mount once, in the root bar.
 */
export function useFollowSpace(): void {
  const viewerId = useViewerId();
  const segments = useSegments() as readonly string[];
  const params = useGlobalSearchParams<{ id?: string }>();
  const companyIds = useViewerCompanyIds();
  const groupId = segments[0] === 'group' && typeof params.id === 'string' ? params.id : null;
  const space = spaceForRoute(segments, groupId, companyIds);
  const home = isHomeTab(segments);
  useEffect(() => {
    if (viewerId === null || space === null) return;
    if (home) {
      // The first Home mount decides the cold-start redirect from what is stored; wait for it.
      if (!coldStartSettled(viewerId)) return;
    } else settleColdStart(viewerId);
    const timer = setTimeout(() => void followSpace(viewerId, space), 400);
    return () => clearTimeout(timer);
  }, [viewerId, space, home]);
}
