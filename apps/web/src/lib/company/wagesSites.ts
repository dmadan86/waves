'use client';

import { useMemo } from 'react';
import { materialiseCompanyProjects, materialiseProjectMembers } from '@waves/core';

import { NO_QUEUE, useSync } from '@/lib/sync';

/** Live sites of this company and which sites each person is on (read-only, web has no queue). */
export function useWagesSites(groupId: string) {
  const { mirror } = useSync();
  return useMemo(
    () => ({
      sites: materialiseCompanyProjects(mirror, NO_QUEUE, { groupId }).filter(
        (p) => !p.deleted_at && !p.archived_at,
      ),
      onSites: materialiseProjectMembers(mirror, NO_QUEUE, { groupId }),
    }),
    [mirror, groupId],
  );
}
