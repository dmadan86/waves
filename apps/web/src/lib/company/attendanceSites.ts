'use client';

/** Company sites and who is on each (web; no offline queue, so NO_QUEUE). */
import { useMemo } from 'react';
import { materialiseCompanyProjects, materialiseProjectMembers } from '@waves/core';

import { NO_QUEUE, useSync } from '@/lib/sync';

export function useAttendanceSites(groupId: string) {
  const { mirror } = useSync();
  return useMemo(
    () => ({
      sites: materialiseCompanyProjects(mirror, NO_QUEUE, { groupId }).filter((p) => !p.deleted_at),
      siteMembers: materialiseProjectMembers(mirror, NO_QUEUE, { groupId }),
    }),
    [mirror, groupId],
  );
}
