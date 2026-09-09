import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useFocusEffect, useSegments } from 'expo-router';
import { AppState, Platform } from 'react-native';

import { plural, type UiStrings } from '@/i18n';
import { legacyKeysMigrated } from '@/lib/legacyKeys';
import {
  beginPersonalCheck,
  DEFAULT_IDLE_GRACE_SECONDS,
  endPersonalCheck,
  getPersonalLockState,
  isPersonalSection,
  isPersonalUnlocked,
  lockClockNow,
  lockPersonal,
  markPersonalUnlocked,
  personalAppActive,
  personalAppAway,
  personalAppTransition,
  setPersonalPresence,
  subscribePersonalLock,
} from '@/lib/personalLock';

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
/**
 * One window, two locks: the whole-app lock and the personal-ledger gate both
 * ask again after this long away, so the single "Ask again after" setting
 * cannot come to mean two different things. The number itself lives once, in
 * `lib/personalLock` (the pure, testable half); this is the name the settings
 * screens already import.
 */
export const DEFAULT_GRACE_SECONDS = DEFAULT_IDLE_GRACE_SECONDS;

interface LockValue {
  /** Whether the user has turned the lock on. */
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
 * App-level biometric / PIN lock (ADR-013). Money apps get handed around —
 * "check the split" should not mean "read my whole ledger".
 *
 * This guards the UI only; the data itself is protected by RLS regardless.
 */
export function LockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [supported, setSupported] = useState(false);
  const [graceSeconds, setGraceState] = useState(DEFAULT_GRACE_SECONDS);
  const [ready, setReady] = useState(false);

  /**
   * When the app was last backgrounded. A ref rather than state because the
   * listener needs the current value without being torn down and rebuilt as it
   * changes — a listener that re-subscribes mid-transition misses the
   * transition.
   */
  const leftAt = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // SecureStore has no web implementation; the lock is a native feature.
      const hasHardware = Platform.OS !== 'web' && (await LocalAuthentication.hasHardwareAsync());
      await legacyKeysMigrated;
      const stored = Platform.OS === 'web' ? null : await SecureStore.getItemAsync(KEY);
      const storedGrace = Platform.OS === 'web' ? null : await SecureStore.getItemAsync(GRACE_KEY);
      if (!active) return;
      setSupported(hasHardware);
      const on = stored === 'true';
      setEnabledState(on);
      // A cold start is always locked, whatever the grace period says. The
      // grace is for coming back to a running app, not for reopening a killed
      // one — and "killed" is indistinguishable from "reinstalled by somebody
      // else holding the phone".
      setLocked(on);
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
      if (state === 'background' || state === 'inactive') {
        // Only the first departure counts. iOS reports `inactive` on the way to
        // `background`, and treating the second as a fresh departure would
        // restart the clock at the moment the phone was put down.
        leftAt.current ??= Date.now();
        return;
      }
      if (state !== 'active') return;
      const away = leftAt.current;
      leftAt.current = null;
      if (away === null) return;
      if (Date.now() - away >= graceSeconds * 1000) setLocked(true);
    });
    return () => subscription.remove();
  }, [enabled, graceSeconds]);

  // The personal ledger's own idle clock. Subscribed always, not only when the
  // app lock is on: the two are independent gates, and the private section is
  // guarded whether or not the whole app is. One subscription for the app, held
  // above every screen, so no personal screen has to be mounted for a departure
  // to be noticed. Which transitions count is `personalAppTransition`'s to say,
  // so this gate and the app lock above cannot come to read them differently.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const move = personalAppTransition(state);
      if (move === 'away') personalAppAway();
      else if (move === 'back') personalAppActive(graceSeconds);
    });
    return () => subscription.remove();
  }, [graceSeconds]);

  // Both prompts below are marked as ours for the personal clock's benefit.
  // Any biometric sheet turns the app inactive, and one the app raised itself
  // is not the user walking away — an app-lock unlock that stamped a personal
  // departure would, at a zero-second window, cost a second prompt the instant
  // the first was answered.
  const unlock = useCallback(async () => {
    beginPersonalCheck();
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Waves',
        fallbackLabel: 'Use passcode',
      });
      if (result.success) setLocked(false);
      return result.success;
    } finally {
      endPersonalCheck();
    }
  }, []);

  const setEnabled = useCallback(async (value: boolean) => {
    if (value) {
      // Prove the device can actually unlock before locking them out of it.
      beginPersonalCheck();
      let confirmed = false;
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Confirm to turn on app lock',
        });
        confirmed = result.success;
      } finally {
        endPersonalCheck();
      }
      if (!confirmed) return;
    }
    // SecureStore has no web implementation, same as the read path above.
    if (Platform.OS !== 'web') await SecureStore.setItemAsync(KEY, value ? 'true' : 'false');
    setEnabledState(value);
    setLocked(false);
  }, []);

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
      {/* Renders nothing; it is the one place that says whether the user is
          inside the private section. A sibling of `children` rather than a hook
          up here, so a route change re-renders this and nothing else. */}
      <PersonalPresence graceSeconds={graceSeconds} />
      {children}
    </LockContext.Provider>
  );
}

/**
 * Keeps the personal lock's idea of "the user is in the section" in step with
 * the router.
 *
 * Presence is a property of where you are, not of which component happened to
 * fire a focus event, and reading it off the path is what lets a push from the
 * Me tab into `personal/entry` cost nothing: one personal route replaces
 * another and presence never changes at all.
 */
function PersonalPresence({ graceSeconds }: { graceSeconds: number }) {
  const segments = useSegments();
  useEffect(() => {
    setPersonalPresence(isPersonalSection(segments as string[]), graceSeconds);
  }, [segments, graceSeconds]);
  return null;
}

export function useLock(): LockValue {
  const value = useContext(LockContext);
  if (!value) throw new Error('useLock must be used inside LockProvider');
  return value;
}

/** What a screen in the private section needs, to choose ledger or shield. */
export interface PersonalGateValue {
  /** Whether the private ledger may be drawn. */
  unlocked: boolean;
  /** Whether the OS prompt is up right now. */
  checking: boolean;
  /** Whether the last check was refused or cancelled, and is awaiting a retry. */
  failed: boolean;
  /** Ask again, after a refusal. */
  retry: () => void;
}

/**
 * The biometric gate on the private personal ledger, independent of the
 * whole-app lock.
 *
 * Every screen in the section mounts this — the Me tab and each `personal/*`
 * room — but they all read one state (`lib/personalLock`), so the first unlock
 * covers the section and walking between its screens never asks again. What
 * ages an unlock is time spent *away*: on a route outside the section, or with
 * the app in the background, for longer than the user's "Ask again after"
 * window — the same setting the app lock uses, so the two can never disagree.
 * Whether the user is in the section is read off the router, not off focus
 * events, so a push has no gap in it to mistake for a departure. A cold start
 * begins locked, and any change of account — signing out, a session revoked
 * from elsewhere, somebody else signing in — shuts it.
 *
 * Until it opens the caller draws a shield rather than the figures, so nothing
 * is ever on show behind the OS prompt. A refused or cancelled check leaves the
 * shield up with a way to try again and a way out; it does not navigate on the
 * user's behalf, because a screen that throws you backwards seconds after you
 * arrived is indistinguishable from a bug.
 *
 * With nothing enrolled to authenticate against there is nothing to ask, so it
 * opens — unchanged from before; RLS still guards the data on the server.
 */
export function usePersonalGate(promptMessage: string): PersonalGateValue {
  const { graceSeconds, supported, ready } = useLock();
  // Third argument is the server snapshot: a static web export prerenders these
  // routes, and the locked state is exactly what a render with no device should
  // produce — the shield.
  const state = useSyncExternalStore(
    subscribePersonalLock,
    getPersonalLockState,
    getPersonalLockState,
  );
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  // The same fact as `focused`, readable from inside an async check that
  // started before the user walked off.
  const onScreen = useRef(false);
  // One prompt at a time. The effect below can re-run while the OS sheet is
  // still up (the grace window arrives asynchronously, and `supported` flips
  // once the hardware check lands), and two stacked biometric prompts is how a
  // device comes to refuse both.
  const asking = useRef(false);

  // The clock is read through a function call, not inline — the React Compiler
  // forbids `Date.now()` in a component body, the same reason `todayIso()` is
  // hoisted. `state` is an argument so this re-evaluates whenever the store moves.
  const unlocked = isPersonalUnlocked(state, lockClockNow(), graceSeconds);

  // Focus decides which screen does the asking — several personal screens can
  // be mounted at once and only the visible one should raise a prompt. It says
  // nothing about presence; that is the router's job (`PersonalPresence`).
  // Leaving also clears a refusal, so coming back asks again rather than
  // greeting the user with the last attempt's failure.
  useFocusEffect(
    useCallback(() => {
      onScreen.current = true;
      setFocused(true);
      return () => {
        onScreen.current = false;
        setFocused(false);
        setFailed(false);
      };
    }, []),
  );

  const ask = useCallback(async (): Promise<void> => {
    if (asking.current) return;
    asking.current = true;
    // From here until the result is applied, an OS transition is our own doing
    // rather than the user leaving.
    beginPersonalCheck();
    try {
      // Nothing to authenticate against (no hardware, nothing enrolled, or
      // web): there is nothing to prompt for, so open. RLS still guards the data.
      const canAsk =
        Platform.OS !== 'web' && supported && (await LocalAuthentication.isEnrolledAsync());
      // Every result below is discarded if the screen that asked has gone. The
      // OS sheet outlives its screen — back out of the section with Android's
      // prompt up and the success lands on nothing — and an answer given to a
      // question the user has walked away from is not consent to open the
      // ledger. The store guards this too (`afterPersonalAuth`); this is the
      // near end of the same rule.
      if (!onScreen.current) return;
      if (!canAsk) {
        markPersonalUnlocked();
        return;
      }
      setChecking(true);
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        fallbackLabel: 'Use passcode',
      });
      if (!onScreen.current) return;
      if (result.success) {
        markPersonalUnlocked();
      } else {
        // Refused: stay shut, and wait to be asked again rather than looping the
        // prompt or navigating away underneath whoever is holding the phone.
        lockPersonal();
        setFailed(true);
      }
    } finally {
      setChecking(false);
      asking.current = false;
      endPersonalCheck();
    }
  }, [supported, promptMessage]);

  useEffect(() => {
    // `ready` first: whether this device can ask at all is read asynchronously,
    // and `supported` is false until it lands. Deciding before then would open
    // the ledger on a phone that could perfectly well have asked. The shield is
    // up in the meantime, so the wait costs a spinner, not a leak.
    if (!ready || !focused || unlocked || failed || checking) return;
    void ask();
  }, [ready, focused, unlocked, failed, checking, ask]);

  const retry = useCallback(() => setFailed(false), []);

  return { unlocked, checking, failed, retry };
}

/** "Straight away", "After 30 seconds" — the words the settings row uses too. */
export function describeGrace(seconds: number, t: UiStrings, locale: string): string {
  if (seconds <= 0) return t.lock.graceImmediate;
  if (seconds < 60) return plural(locale, seconds, t.lock.graceSeconds);
  return plural(locale, Math.round(seconds / 60), t.lock.graceMinutes);
}
