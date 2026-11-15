import { useMemo } from 'react';

import { useAllGroupMembers, useGroups } from '@/data/hooks';
import { useViewerId } from '@/lib/auth';
import { viewerCompanyIds, viewerRoleIn } from '@/lib/companyTab';

/**
 * The viewer's companies, read from the local mirror (no network), so the
 * Review/Company tab swap follows a create, join or leave at once.
 */
export function useViewerCompanyIds(): string[] {
  const groups = useGroups().data;
  const members = useAllGroupMembers();
  const viewerId = useViewerId();
  return useMemo(
    () => viewerCompanyIds(groups ?? [], members, viewerId),
    [groups, members, viewerId],
  );
}

/** The viewer's role in one group, from the local mirror (cheap, no network). */
export function useViewerRole(groupId: string | null): string | null {
  const members = useAllGroupMembers();
  const viewerId = useViewerId();
  return useMemo(() => viewerRoleIn(members, groupId, viewerId), [members, groupId, viewerId]);
}
