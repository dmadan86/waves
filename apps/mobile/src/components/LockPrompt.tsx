/**
 * The one-time ask for the app lock. The lock is off until somebody says yes:
 * on Home, from the launch after they signed up, once. "Turn on" proves the
 * device can unlock (the system sheet); "Not now" or a dismissal stores a no,
 * and Settings > Privacy can still turn it on later.
 */

import { useEffect, useRef, useState } from 'react';
import { useSegments } from 'expo-router';

import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { useLock } from '@/lib/lock';
import { usePromptSlot } from '@/lib/promptQueue';

export function LockPrompt() {
  const { t } = useStrings();
  const { confirm } = useDialog();
  const { shouldAsk, locked, setEnabled } = useLock();
  const onHome = useSegments()[0] === '(tabs)';
  // Answered this launch, however it went: the slot goes back to the queue even
  // when a cancelled check stored nothing (the ask then returns next launch).
  const [done, setDone] = useState(false);
  const granted = usePromptSlot({
    id: 'lockPrompt',
    priority: 90,
    active: shouldAsk && !done && !locked && onHome,
    delayMs: 300,
  });
  const asked = useRef(false);

  useEffect(() => {
    if (!granted || asked.current) return;
    asked.current = true;
    void (async () => {
      const yes = await confirm({
        title: t.lock.askTitle,
        body: t.lock.askBody,
        confirmLabel: t.lock.askYes,
        cancelLabel: t.entry.notifyNotNow,
      });
      // A cancelled fingerprint check stores nothing, so the ask returns next launch.
      try {
        await setEnabled(yes);
      } finally {
        setDone(true);
      }
    })();
  }, [granted, confirm, setEnabled, t]);

  return null;
}
