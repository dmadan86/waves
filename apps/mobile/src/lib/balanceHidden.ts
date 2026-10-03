/**
 * The eye toggle's state — hide every money figure on a shared screen behind a
 * mask, remembered across opens. One key, shared by Home and Friends, so
 * shutting the money on one hides it on the other: it is the same question
 * ("can whoever is looking at my phone see what I owe?") wherever it is asked,
 * not a separate switch per screen.
 *
 * Reads once (so a hidden balance stays hidden after a relaunch, not flashing
 * the number first) and writes on every toggle. Defaults to shown.
 *
 * Home and Friends are both tabs that stay mounted at the same time, so the
 * hidden flag lives in one module-level store shared by every subscriber
 * (via `useSyncExternalStore`) rather than a `useState` per call — toggling
 * on one screen must be reflected on the other immediately, not just after a
 * remount.
 */

import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BALANCE_HIDDEN_KEY = 'dashboard:balanceHidden';

type BalanceHiddenState = { hidden: boolean; ready: boolean };

let state: BalanceHiddenState = { hidden: false, ready: false };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

let loadStarted = false;
function ensureLoaded() {
  if (loadStarted) return;
  loadStarted = true;
  AsyncStorage.getItem(BALANCE_HIDDEN_KEY)
    .then((value) => {
      if (value === '1') state = { ...state, hidden: true };
    })
    .catch(() => {})
    .finally(() => {
      state = { ...state, ready: true };
      emit();
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

function toggleShared() {
  const next = !state.hidden;
  state = { ...state, hidden: next };
  void AsyncStorage.setItem(BALANCE_HIDDEN_KEY, next ? '1' : '0').catch(() => {});
  emit();
}

export function useBalanceHidden(): { hidden: boolean; ready: boolean; toggle: () => void } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const toggle = useCallback(() => {
    toggleShared();
  }, []);
  return { hidden: snapshot.hidden, ready: snapshot.ready, toggle };
}
