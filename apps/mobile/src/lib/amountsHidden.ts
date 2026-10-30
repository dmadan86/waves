/**
 * Whether the Personal dashboard's figures are hidden behind the eye.
 *
 * Shared by the dashboard's eye button and Settings → Security, so flipping it
 * in one place updates the other without a reload. Persisted, defaults to shown.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

const KEY = 'personal:amountsHidden';

let hidden = false;
let loaded = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePersonalAmountsHidden(): { hidden: boolean; toggle: () => void } {
  const value = useSyncExternalStore(subscribe, () => hidden);
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    AsyncStorage.getItem(KEY)
      .then((stored) => {
        if (stored === '1' && !hidden) {
          hidden = true;
          emit();
        }
      })
      .catch(() => {});
  }, []);
  const toggle = useCallback(() => {
    hidden = !hidden;
    emit();
    void AsyncStorage.setItem(KEY, hidden ? '1' : '0').catch(() => {});
  }, []);
  return { hidden: value, toggle };
}
