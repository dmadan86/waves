/**
 * Whether the first real screen is ready to be shown.
 *
 * The launch splash used to leave on a timer, whether or not anything was ready
 * underneath it. When the app was still deciding who was signed in, what it
 * revealed was a white screen with a spinner on it, and only then the app — the
 * one moment of the launch that looked broken. Now the splash waits for this
 * instead, so it hands over straight to a screen worth looking at.
 *
 * Module state rather than context: the splash sits above the gates that know
 * the answer, and the answer only ever moves one way, once per process.
 */
import { useSyncExternalStore } from 'react';

let ready = false;
let screenReady = false;
// Home holds the splash while it decides whether launch reopens a company, so Personal never shows first.
let held = false;
const listeners = new Set<() => void>();

function settle(): void {
  if (ready || !screenReady || held) return;
  ready = true;
  for (const listener of listeners) listener();
  listeners.clear();
}

/** Called by whichever screen is first to be worth showing. Idempotent. */
export function markLaunchReady(): void {
  screenReady = true;
  settle();
}

/** Keeps the splash up (on) until the first screen is the right one. No effect once lifted. */
export function holdLaunch(on: boolean): void {
  if (ready) return;
  held = on;
  settle();
}

export function isLaunchReady(): boolean {
  return ready;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders once, when the first screen is ready. */
export function useLaunchReady(): boolean {
  return useSyncExternalStore(subscribe, isLaunchReady, isLaunchReady);
}

/** Tests only: a fresh process. */
export function resetLaunchReadyForTest(): void {
  ready = false;
  screenReady = false;
  held = false;
  listeners.clear();
}
