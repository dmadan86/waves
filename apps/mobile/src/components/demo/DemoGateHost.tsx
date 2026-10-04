/**
 * Turns a blocked demo write into the sheet the person actually sees.
 *
 * Mounted once, inside `DialogProvider` (see `_layout.tsx`) — the write gets
 * blocked a layer further up, inside `useSync()`'s `mutate` (`@/sync/provider`),
 * which sits *above* `DialogProvider` in the tree and so cannot call
 * `useDialog()` itself. It fires `requestDemoGate()` instead; this is the one
 * place that listens, with a `confirm()` already in scope.
 */

import { useEffect } from 'react';

import { useDialog } from '@/lib/dialog';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { subscribeDemoGate } from '@/demo/gateStore';

export function DemoGateHost(): null {
  const { confirm } = useDialog();
  const { t } = useStrings();

  useEffect(
    () =>
      subscribeDemoGate(() => {
        void confirm({
          title: t.demo.gateTitle,
          body: t.demo.gateBody,
          confirmLabel: t.demo.gateCreateGroup,
          cancelLabel: t.demo.gateKeepExploring,
        }).then((createGroup) => {
          if (createGroup) router.push('/new-group');
        });
      }),
    [confirm, t],
  );

  return null;
}
