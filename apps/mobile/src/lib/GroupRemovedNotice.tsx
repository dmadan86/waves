/** Renders nothing: says "You are no longer in X" and leaves a group an admin removed you from. */
import { useEffect } from 'react';
import { usePathname } from 'expo-router';

import { fill, useStrings } from '@/i18n';
import { insideRemovedGroup, onGroupsRemoved } from '@/lib/groupRemoved';
import { router } from '@/lib/navigation';
import { useToast } from '@/lib/toast';

export function GroupRemovedNotice() {
  const { t } = useStrings();
  const toast = useToast();
  const pathname = usePathname();

  useEffect(
    () =>
      onGroupsRemoved((groups) => {
        toast.show(
          fill(t.misc.removedFromGroup, { group: groups[0]?.name ?? t.misc.someone }),
        );
        if (insideRemovedGroup(pathname, groups)) router.replace('/');
      }),
    [pathname, t, toast],
  );
  return null;
}
