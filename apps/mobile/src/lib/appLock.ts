/**
 * The pure decisions of the one app-wide lock. No React, no react-native: the
 * wiring (biometrics, AppState, auth) is in `lib/lock.tsx`; this is what is
 * unit-tested (test/appLock.test.ts).
 */

/** Seconds away before the lock asks again, when the user has not chosen. */
export const DEFAULT_GRACE_SECONDS = 30;

/** Can this device lock at all: biometric hardware AND biometrics or a passcode set up. */
export function canDeviceLock(
  hasHardware: boolean,
  enrolled: boolean,
  levelNone: boolean,
): boolean {
  return hasHardware && (enrolled || !levelNone);
}

/**
 * Default ON. Only an explicit stored "false" (the user turned it off) wins;
 * anything else - nothing stored, or "true" - follows what the device can do.
 */
export function resolveLockEnabled(stored: string | null, canLock: boolean): boolean {
  return canLock && stored !== 'false';
}

/** Back from being away: ask again once the absence reaches the grace window. */
export function shouldRelock(awayMs: number, graceSeconds: number): boolean {
  return awayMs >= graceSeconds * 1000;
}

/**
 * What an `AppState` value means to the lock: gone, back, or neither.
 * `inactive` counts as leaving (the iOS app switcher reports it before
 * `background`); our own biometric sheet also reports it and is excluded by
 * `beginCheck`/`checking`.
 */
export function lockAwayTransition(state: string): 'away' | 'back' | 'ignore' {
  if (state === 'background' || state === 'inactive') return 'away';
  if (state === 'active') return 'back';
  return 'ignore';
}

/**
 * Biometric checks currently up. The OS sheet turns the app `inactive` (iOS) or
 * pauses the activity (Android); counting our own prompt as the user leaving
 * would re-lock the app because we asked it to unlock.
 */
let checks = 0;
export const beginCheck = (): void => {
  checks += 1;
};
export const endCheck = (): void => {
  checks = Math.max(0, checks - 1);
};
export const checking = (): boolean => checks > 0;
