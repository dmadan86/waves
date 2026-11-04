'use client';

import { useMemo } from 'react';
import { materialiseCompanyProjects } from '@waves/core';

import { NO_QUEUE, useSync } from '@/lib/sync';

/** Live sites of a company, for the event form's site picker. */
export function useProjects(groupId: string) {
  const { mirror } = useSync();
  return useMemo(
    () => materialiseCompanyProjects(mirror, NO_QUEUE, { groupId }).filter((p) => !p.deleted_at),
    [mirror, groupId],
  );
}
