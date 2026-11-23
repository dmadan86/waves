/**
 * Whether a voice hold is under way — the finger on the mic, or the sentence it
 * left still being read. Pop-ups (backup reminder, tips, the push ask) wait
 * while it is: nothing may cover the pill somebody is talking into.
 */
import { useSyncExternalStore } from 'react';

let busy = false;
const listeners = new Set<() => void>();

export function setVoiceBusy(next: boolean): void {
  if (busy === next) return;
  busy = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVoiceBusy(): boolean {
  return useSyncExternalStore(subscribe, () => busy);
}
