import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { useGroup } from '@/data/hooks';

/**
 * A company group takes company entries, not shared expenses, imports or
 * recurring rules (the server refuses them). Any way into one of those screens
 * — a stale link, a stored deep link — lands on the group's own home instead.
 * Returns true once the group is known to be a company, so the screen can
 * render nothing while it leaves.
 */
export function useCompanyGroupGuard(groupId: string): boolean {
  const router = useRouter();
  const { group } = useGroup(groupId);
  const blocked = group.data?.type === 'company';
  useEffect(() => {
    if (blocked) router.replace(`/group/${groupId}`);
  }, [blocked, groupId, router]);
  return blocked;
}
