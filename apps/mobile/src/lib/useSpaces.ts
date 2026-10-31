import { useCallback, useEffect, useState } from 'react';
import { useGlobalSearchParams, useSegments } from 'expo-router';

import { useViewerId } from '@/lib/auth';
import { useViewerCompanyIds } from '@/lib/useCompanyTab';
import { router } from '@/lib/navigation';
import {
  coldStartPlan,
  coldStartSettled,
  followSpace,
  isHomeTab,
  readLastSpace,
  rememberSpace,
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
 * Cold start: the first Home mount opens the remembered company. Returns true while that is
 * undecided, so Home paints nothing (no Personal flash) until it stays or redirects. Deep links
 * never mount Home first, so they are left alone. `ready` waits for the local mirror.
 */
export function useColdStartSpace(ready: boolean, companyIds: readonly string[]): boolean {
  const viewerId = useViewerId();
  const [stored, setStored] = useState<string | null | undefined>(undefined);
  const [done, setDone] = useState(false);
  const holding = viewerId !== null && !done && !coldStartSettled(viewerId);
  useEffect(() => {
    if (viewerId === null || coldStartSettled(viewerId)) return;
    let stale = false;
    void readLastSpace(viewerId).then((value) => !stale && setStored(value));
    return () => {
      stale = true;
    };
  }, [viewerId]);
  useEffect(() => {
    if (viewerId === null || stored === undefined || done) return;
    const plan = coldStartPlan(stored, ready, companyIds);
    if (plan === 'wait') return;
    // A deep link that settled first wins: takeColdStart is then false and nothing redirects.
    if (takeColdStart(viewerId) && plan !== 'stay' && plan !== 'personal')
      router.replace(`/group/${plan}`);
    setDone(true);
  }, [viewerId, stored, ready, companyIds, done]);
  return holding;
}

const ONBOARDING = new Set([
  'sign-in',
  'sign-up',
  'welcome',
  'verify-email',
  'phone',
  'guest-welcome',
  'language',
  'country',
]);

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
    if (viewerId === null) return;
    // Any real screen other than Home reached first means the link wins: no redirect later.
    if (!home && segments.length > 0 && !ONBOARDING.has(segments[0] ?? ''))
      settleColdStart(viewerId);
    if (space === null) return;
    // The first Home mount decides the cold-start redirect from what is stored; wait for it.
    if (home && !coldStartSettled(viewerId)) return;
    const timer = setTimeout(() => void followSpace(viewerId, space), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- segments is read only for its root
  }, [viewerId, space, home]);
}
