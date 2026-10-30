import { useCallback, useEffect } from 'react';

import { useViewerId } from '@/lib/auth';
import { router } from '@/lib/navigation';
import {
  readLastSpace,
  rememberSpace,
  resolveSpace,
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
    if (!ready || viewerId === null || !takeColdStart(viewerId)) return;
    void readLastSpace(viewerId).then((stored) => {
      const space = resolveSpace(stored, companyIds);
      if (space !== 'personal') router.replace(`/group/${space}`);
    });
  }, [ready, viewerId, companyIds]);
}
