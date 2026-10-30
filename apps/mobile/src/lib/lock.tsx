import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { plural, type UiStrings } from '@/i18n';
import {
  beginCheck,
  canDeviceLock,
  checking,
  DEFAULT_GRACE_SECONDS,
  endCheck,
  lockAwayTransition,
  resolveLockEnabled,
  shouldRelock,
} from '@/lib/appLock';
import { useAuth } from '@/lib/auth';
import { legacyKeysMigrated } from '@/lib/legacyKeys';

export { DEFAULT_GRACE_SECONDS };

const KEY = 'waves.app_lock_enabled';
const GRACE_KEY = 'waves.app_lock_grace_seconds';

/**
 * How long the app may stay open after being backgrounded before it asks again.
 *
 * A lock that re-authenticates the instant you glance at a notification is a
 * lock people turn off, and one that never re-authenticates is decoration. The
 * default is thirty seconds: long enough to be sent to a UPI app and come back,
 * short enough that a phone left on a table is not an open ledger.
 */
export const GRACE_CHOICES = [0, 15, 30, 60, 300] as const;
interface LockValue {
  /** Whether the lock is on (default on where the device can lock). */
  enabled: boolean;
  /** Whether the app is currently waiting to be unlocked. */
  locked: boolean;
  supported: boolean;
  /**
   * False until the stored state and the hardware check have both come back.
   * Whether a device can lock is read asynchronously, and `supported` starts
   * false, so a row rendered before this is true would say 'not available' on a
   * phone that supports it perfectly well — the worst possible flicker on a
   * security setting.
   */
  ready: boolean;
  /** Seconds in the background before the lock comes back. */
  graceSeconds: number;
  setEnabled: (value: boolean) => Promise<void>;
  setGraceSeconds: (value: number) => Promise<void>;
  unlock: () => Promise<boolean>;
}

const LockContext = createContext<LockValue | null>(null);

/**
 * The one app-wide biometric / PIN lock (ADR-013). Money apps get handed around -
 * "check the split" should not mean "read my whole ledger".
 *
 * On by default where the device can lock. It asks on a cold start of a
 * signed-in app and when the app comes back after being away longer than the
 * "Ask again after" window - never right after the user signed in or up.
 * This guards the UI only; the data itself is protected by RLS regardless.
 */
export function LockProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user?.id ?? null;
  const [enabled, setEnabledState] = useState(false);
  const [supported, setSupported] = useState(false);
  const [graceSeconds, setGraceState] = useState(DEFAULT_GRACE_SECONDS);
  const [ready, setReady] = useState(false);
  /**
   * The user id that must unlock, or null. Locked is "this id is signed in and
   * is the one waiting", so a different id signing in (a fresh sign-in or an
   * account switch) is never locked, and sign-out clears it below.
   */
  const [needs, setNeeds] = useState<string | null>(null);
  const [decided, setDecided] = useState(false);

  // Adjusted during render, not in an effect, so there is no frame in which a
  // cold-started signed-in app draws unlocked. The first settled answer to "who
  // is signed in" is the cold start; anyone who appears later just signed in.
  if (!decided && ready && !authLoading) {
    setDecided(true);
    setNeeds(userId);
  } else if (decided && needs !== null && needs !== userId) {
    // Signed out or switched account: the unlock owed belonged to that account.
    setNeeds(null);
  }
  // Until the cold-start answer is in, a signed-in user is treated as locked.
  const locked = ready && enabled && userId !== null && (!decided || needs === userId);

  /** When the app was last backgrounded; a ref so the listener never re-subscribes mid-transition. */
  const leftAt = useRef<number | null>(null);
  const asking = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      // SecureStore has no web implementation; the lock is a native feature.
      const native = Platform.OS !== 'web';
      let canLock = false;
      let queryFailed = false;
      if (native) {
        try {
          canLock = canDeviceLock(
            await LocalAuthentication.hasHardwareAsync(),
            await LocalAuthentication.isEnrolledAsync(),
            (await LocalAuthentication.getEnrolledLevelAsync()) ===
              LocalAuthentication.SecurityLevel.NONE,
          );
        } catch {
          // Can't tell what the device can do: never drop a lock the user turned on.
          queryFailed = true;
        }
      }
      await legacyKeysMigrated;
      const stored = native ? await SecureStore.getItemAsync(KEY) : null;
      const storedGrace = native ? await SecureStore.getItemAsync(GRACE_KEY) : null;
      if (!active) return;
      setSupported(canLock);
      setEnabledState(queryFailed ? stored === 'true' : resolveLockEnabled(stored, canLock));
      const parsed = Number(storedGrace);
      if (storedGrace !== null && Number.isFinite(parsed) && parsed >= 0) setGraceState(parsed);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      const move = lockAwayTransition(state);
      if (move === 'away') {
        // Our own biometric sheet turns the app inactive; that is not leaving.
        if (checking()) return;
        // Only the first departure counts: iOS reports `inactive` on the way to
        // `background`, and the second must not restart the clock.
        leftAt.current ??= Date.now();
        return;
      }
      if (move !== 'back') return;
      const away = leftAt.current;
      leftAt.current = null;
      if (away === null || userId === null) return;
      if (shouldRelock(Date.now() - away, graceSeconds)) setNeeds(userId);
    });
    return () => subscription.remove();
  }, [enabled, graceSeconds, userId]);

  const authenticate = useCallback(async (promptMessage: string, fallbackLabel?: string) => {
    beginCheck();
    try {
      return (await LocalAuthentication.authenticateAsync({ promptMessage, fallbackLabel }))
        .success;
    } catch {
      // A cancelled or failed check is not an event to announce: stay locked.
      return false;
    } finally {
      endCheck();
    }
  }, []);

  const unlock = useCallback(async () => {
    // One sheet at a time; stacked prompts are how a device refuses both.
    if (asking.current) return false;
    asking.current = true;
    try {
      const ok = await authenticate('Unlock Waves', 'Use passcode');
      if (ok) setNeeds(null);
      return ok;
    } finally {
      asking.current = false;
    }
  }, [authenticate]);

  const setEnabled = useCallback(
    async (value: boolean) => {
      // Prove the device can actually unlock before locking them out of it.
      if (value && !(await authenticate('Confirm to turn on app lock'))) return;
      // SecureStore has no web implementation, same as the read path above.
      if (Platform.OS !== 'web') await SecureStore.setItemAsync(KEY, value ? 'true' : 'false');
      setEnabledState(value);
      setNeeds(null);
    },
    [authenticate],
  );

  const setGraceSeconds = useCallback(async (value: number) => {
    if (Platform.OS !== 'web') await SecureStore.setItemAsync(GRACE_KEY, String(value));
    setGraceState(value);
  }, []);

  return (
    <LockContext.Provider
      value={{
        enabled,
        locked,
        supported,
        ready,
        graceSeconds,
        setEnabled,
        setGraceSeconds,
        unlock,
      }}
    >
      {children}
    </LockContext.Provider>
  );
}

export function useLock(): LockValue {
  const value = useContext(LockContext);
  if (!value) throw new Error('useLock must be used inside LockProvider');
  return value;
}

/** "Straight away", "After 30 seconds" — the words the settings row uses too. */
export function describeGrace(seconds: number, t: UiStrings, locale: string): string {
  if (seconds <= 0) return t.lock.graceImmediate;
  if (seconds < 60) return plural(locale, seconds, t.lock.graceSeconds);
  return plural(locale, Math.round(seconds / 60), t.lock.graceMinutes);
}
