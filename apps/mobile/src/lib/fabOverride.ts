import { useEffect, useSyncExternalStore } from 'react';

/** A screen that wants the company bar's round add button for its own action (Team › Tasks: add a task). */
type Override = { label: string; run: () => void } | null;
let current: Override = null;
const listeners = new Set<() => void>();
const set = (next: Override) => {
  current = next;
  listeners.forEach((l) => l());
};

export function useFabOverride(): Override {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
  );
}

/** Claims the button while `active`; releases it on blur/unmount. */
export function useClaimFab(active: boolean, label: string, run: () => void) {
  useEffect(() => {
    if (!active) return;
    const mine = { label, run };
    set(mine);
    return () => {
      if (current === mine) set(null);
    };
  }, [active, label, run]);
}
