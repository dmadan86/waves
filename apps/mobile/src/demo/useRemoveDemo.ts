/**
 * "Remove demo" — the one, final way the fixture ever leaves. Shared by the
 * demo group's own overflow menu and the Settings row, so the confirmation
 * reads the same word for word wherever it is reached from.
 */

import { useDialog } from '@/lib/dialog';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';

import { removeDemo } from './store';

/** Returns whether the demo was actually removed — `false` on cancel, or
 *  with nobody signed in. Callers that navigate away (the group screen,
 *  which is about to stop existing) act only on `true`. */
export function useRemoveDemo(): () => Promise<boolean> {
  const { confirm } = useDialog();
  const { t } = useStrings();
  const viewerId = useViewerId();

  return async () => {
    if (!viewerId) return false;
    const ok = await confirm({
      title: t.demo.removeConfirmTitle,
      body: t.demo.removeConfirmBody,
      confirmLabel: t.demo.removeConfirmCta,
      tone: 'danger',
    });
    if (!ok) return false;
    await removeDemo(viewerId);
    return true;
  };
}
