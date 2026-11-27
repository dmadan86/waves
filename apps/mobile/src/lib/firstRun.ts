/**
 * The first-run gate: one place that knows whether something is on screen that
 * the product tour must not land on top of.
 *
 * Anything that covers Home (the intro, a dialog, an ad sheet, a permission
 * explainer or the native permission dialog) registers a reason while it is up.
 * The tour starts only when `tourMayStart` says every condition is clear, and
 * waits (by re-evaluating when the set changes) otherwise — no timeouts.
 */

import { useSyncExternalStore } from 'react';

const reasons = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function setOverlayBusy(reason: string, busy: boolean): void {
  if (busy === reasons.has(reason)) return;
  if (busy) reasons.add(reason);
  else reasons.delete(reason);
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function overlayBusy(): boolean {
  return reasons.size > 0;
}

export function resetOverlayBusy(): void {
  reasons.clear();
  version += 1;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders the caller whenever an overlay appears or goes. */
export function useOverlayBusy(): boolean {
  useSyncExternalStore(subscribe, () => version);
  return overlayBusy();
}

/** Read by prompt arbitration so every full-screen overlay pauses queued prompts. */
export function useOverlayBusyState(): boolean {
  useSyncExternalStore(subscribe, () => version);
  return overlayBusy();
}

export interface TourGate {
  /** The "seen" flag has been read for this account. */
  tourReady: boolean;
  tourSeen: boolean;
  /** Home's data and balance have settled. */
  dataReady: boolean;
  /** The 3-card intro is still up over the app. */
  introVisible: boolean;
  /** Any sheet, dialog, ad or permission prompt is up. */
  busy: boolean;
  /** No higher-priority prompt (e.g. the device limit) holds the screen. */
  promptGranted: boolean;
  /** Home is the focused screen. */
  focused: boolean;
  /** Entrance animations and navigation transitions have finished. */
  interactionsDone: boolean;
}

/** Pure: may the tour start right now? */
export function tourMayStart(g: TourGate): boolean {
  return (
    g.tourReady &&
    !g.tourSeen &&
    g.dataReady &&
    !g.introVisible &&
    !g.busy &&
    g.promptGranted &&
    g.focused &&
    g.interactionsDone
  );
}

/**
 * True while a first-run gate covers Home: the intro cards, or the setup flow
 * (its spinner while `/start` loads, and `/start` itself). The tour stays down.
 */
export function firstRunGateUp(g: {
  showIntro: boolean;
  signedIn: boolean;
  flow: 'wait' | 'show' | 'skip' | 'mark-existing';
}): boolean {
  return (g.showIntro && g.signedIn) || g.flow === 'show';
}

/** A measured target is only worth a spotlight if it sits on the screen. */
export function tourRectVisible(
  r: { x: number; y: number; width: number; height: number } | undefined,
  screenW: number,
  screenH: number,
): boolean {
  return (
    !!r &&
    r.width > 0 &&
    r.height > 0 &&
    r.x + r.width > 0 &&
    r.y + r.height > 0 &&
    r.x < screenW &&
    r.y < screenH
  );
}
