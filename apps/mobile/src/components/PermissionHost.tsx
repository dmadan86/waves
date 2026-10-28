import { useEffect } from 'react';

import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { registerPermissionExplainer } from '@/lib/permissionFlow';
import { setOverlayBusy } from '@/lib/firstRun';

/** Renders nothing: draws our one-sheet explainer for every permission ask. */
export function PermissionHost() {
  const { t } = useStrings();
  const { confirm } = useDialog();
  useEffect(
    () =>
      registerPermissionExplainer(async (kind, step) => {
        const copy = t.misc.permission;
        const text = copy.kinds[kind];
        setOverlayBusy('permission-explainer', true);
        try {
          const ok = await confirm({
            title: text.title,
            body: step === 'settings' ? `${text.body} ${copy.blocked}` : text.body,
            confirmLabel: step === 'settings' ? copy.openSettings : copy.continue,
            cancelLabel: copy.notNow,
          });
          if (!ok) return 'cancel';
          return step === 'settings' ? 'settings' : 'continue';
        } finally {
          setOverlayBusy('permission-explainer', false);
        }
      }),
    [t, confirm],
  );
  return null;
}
