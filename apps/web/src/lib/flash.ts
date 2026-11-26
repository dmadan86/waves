import { useSyncExternalStore } from 'react';

/**
 * One message that outlives the page that set it, so "Expense deleted" can be
 * said after the delete has already navigated away. `undo` is optional.
 */
export interface Flash {
  message: string;
  undo?: { label: string; run: () => void | Promise<void> };
}

let current: Flash | null = null;
const listeners = new Set<() => void>();

export function showFlash(flash: Flash): void {
  current = flash;
  listeners.forEach((listener) => listener());
}

export function dismissFlash(): void {
  current = null;
  listeners.forEach((listener) => listener());
}

export function currentFlash(): Flash | null {
  return current;
}

export function useFlash(): Flash | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
