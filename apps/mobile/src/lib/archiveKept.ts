import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'waves.archiveKept';

/** Groups the person said "Keep" to, so the archive offer is never repeated for them. */
export function useKeptGroups(): {
  kept: ReadonlySet<string>;
  ready: boolean;
  keep: (id: string) => void;
} {
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setKept(new Set(JSON.parse(raw) as string[]));
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);
  // Dismisses at once; a failed write only means it may be asked again after a restart.
  const keep = useCallback((id: string) => {
    setKept((prev) => {
      const next = new Set(prev).add(id);
      AsyncStorage.setItem(KEY, JSON.stringify([...next])).catch(() => undefined);
      return next;
    });
  }, []);
  return { kept, ready, keep };
}
