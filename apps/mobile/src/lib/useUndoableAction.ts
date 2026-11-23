import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useStrings } from '@/i18n';
import { useToast } from '@/lib/toast';
import { createUndoScheduler } from '@/lib/undoScheduler';

export interface UndoableActionOptions {
  message: string;
  undoMessage?: string;
  key?: string;
}

export function useUndoableAction() {
  const toast = useToast();
  const { t } = useStrings();
  const [scheduler] = useState(createUndoScheduler);
  const [, refresh] = useState(0);
  const onBackground = useCallback(
    (state: string) => {
      if (state !== 'active') scheduler.flush();
    },
    [scheduler],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', onBackground);
    return () => {
      subscription.remove();
      scheduler.flush();
    };
  }, [onBackground, scheduler]);

  const run = useCallback(
    (commit: () => void | Promise<void>, options: UndoableActionOptions) => {
      const key = options.key ?? 'default';
      scheduler.schedule(
        key,
        () => {
          void commit();
        },
        5000,
        () => refresh((n) => n + 1),
      );
      refresh((n) => n + 1);
      toast.show(
        options.message,
        'positive',
        {
          label: t.voice.autoUndo,
          onPress: () => {
            if (scheduler.cancel(key)) {
              refresh((n) => n + 1);
              toast.show(options.undoMessage ?? t.common.cancelled, 'info', undefined, 1800);
            }
          },
        },
        5000,
      );
    },
    [scheduler, t.voice.autoUndo, t.common.cancelled, toast],
  );

  const undo = useCallback(
    (key = 'default', undoMessage = t.common.cancelled) => {
      if (!scheduler.cancel(key)) return false;
      refresh((n) => n + 1);
      toast.show(undoMessage, 'info', undefined, 1800);
      return true;
    },
    [scheduler, t.common.cancelled, toast],
  );

  return { run, undo, isPending: (key = 'default') => scheduler.has(key) };
}
