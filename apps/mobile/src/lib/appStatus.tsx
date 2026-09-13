/**
 * Asking the server whether it has anything to say, and remembering the answer.
 *
 * This is the plumbing under `appState` in @waves/core: it fetches the two
 * operator-written tables (`app_releases`, `app_notices`), caches them, tracks
 * what has been waved away on this device, and hands the lot to the pure
 * decider on every render. Nothing here decides anything — that is the point of
 * the split, and it is why the rules this feature must not break are tested
 * without a renderer.
 *
 * It replaces `lib/update.tsx`, which did the same for the release policy
 * alone. Everything that file guaranteed still holds; there is simply more than
 * one thing the operator can now say.
 *
 * ## The rule
 *
 * **Nothing here may stop somebody adding an expense.** `SyncProvider` is
 * mounted *above* `UpdateGate` in `_layout.tsx`, so even under the version wall
 * the engine keeps running and the offline queue keeps draining: work sitting
 * on a force-gated phone is not stranded, it syncs as it always would, and
 * nothing in this file clears a queue or touches the mirror. A maintenance or
 * incident notice does less than that again — it is a card at the top of the
 * screen and has no other effect on anything.
 *
 * ## Failing open, and the one exception
 *
 * No network, a 500, a timeout, a body that turns out to be a number: every one
 * of them leaves the cached answer in place and, if there is no cache, means
 * silence. A gate that fired on a failed fetch would lock people out of their
 * own ledger during precisely the incident it existed to describe.
 *
 * The one deliberate exception is the *cache*. A policy that has been fetched
 * is honoured offline, because "this build computes money wrongly" does not
 * stop being true when the phone loses signal. Every foreground re-asks, so a
 * corrected policy takes hold as soon as there is a connection.
 *
 * ## What is remembered, and for how long
 *
 * A soft update prompt is dismissed *per version*: waving away 1.5.0 says
 * nothing about 1.6.0, so the banner is not a thing people learn to ignore but
 * it does come back when there is genuinely something new. A notice is
 * dismissed *per row id*, which behaves the same way — this incident, not
 * incidents in general. Both live in AsyncStorage, survive a restart, and are
 * per-device rather than per-account: what the operator is saying is a property
 * of the phone and the server, not of who is signed in, and it has to work
 * before anybody is.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { AppState, Linking, Platform } from 'react-native';

import { appState, type AppStateView } from '@waves/core';

import { fetchAppNotices, fetchReleasePolicy } from '@/data/api';
import { deviceCountry, useStrings } from '@/i18n';
import { legacyKeysMigrated } from '@/lib/legacyKeys';

/** Kept at the old name: a cache written by the previous build is still good. */
const POLICY_KEY = 'waves.release_policy';
const NOTICES_KEY = 'waves.app_notices';
const DISMISSED_KEY = 'waves.update_dismissed';
const DISMISSED_NOTICES_KEY = 'waves.notices_dismissed';

/**
 * What this binary calls itself.
 *
 * `expo-constants` rather than `expo-application`: without `expo-updates` in
 * the project the JS bundle cannot be swapped after install, so the version
 * baked in at build time is the version running. That keeps this check free of
 * a native module, which matters — a native module missing from a build is how
 * this app has previously lost a whole screen.
 *
 * The version *name* and not the build number, on purpose. The name is what the
 * store shows, what a person reads in Settings, and what an operator types into
 * the console; `versionCode`/`CFBundleVersion` is monotonic but is a number
 * nobody outside the build pipeline has ever seen, so a wall saying "you are on
 * 4127" would be unanswerable. Monotonicity is recovered by comparing
 * *segments* rather than strings (`compareVersions`), which is the property
 * that actually matters — and the release pipeline never ships a name that goes
 * backwards.
 */
const INSTALLED = Constants.expoConfig?.version ?? '0.0.0';

/** Web has no store to send anybody to, so there is nothing to enforce. */
const PLATFORM: 'ios' | 'android' | 'web' =
  Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

/** Anything unreadable is a cache we do not have. Never throws. */
function readJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readStringList(raw: string | null): string[] {
  const parsed = readJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === 'string');
}

interface AppStatusValue extends AppStateView {
  /** The version installed on this phone, for the wall's footnote. */
  installed: string;
  /**
   * The instant every decision above was made at, re-taken on each foreground.
   *
   * Handed out rather than re-read by the banner, because a component may not
   * call a clock during a render — and because a banner that formatted a window
   * against a different instant from the one that decided the phase could say
   * "starts at 2pm" under a title that already reads "under way".
   */
  now: number;
  /** Wave away the soft update prompt for the version currently offered. */
  dismissUpdate: () => void;
  /** Wave away one notice, by id. */
  dismissNotice: (id: string) => void;
  /** Opens the store page. A no-op when there is nowhere to send anybody. */
  openStore: () => void;
  /** Ask again — the "I have already updated" out on the blocking screen. */
  recheck: () => Promise<void>;
}

const AppStatusContext = createContext<AppStatusValue | null>(null);

export function AppStatusProvider({ children }: { children: ReactNode }) {
  const [release, setRelease] = useState<unknown>(null);
  const [notices, setNotices] = useState<unknown>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [dismissedNotices, setDismissedNotices] = useState<readonly string[]>([]);
  // Re-derived on every foreground so a maintenance window that starts while
  // the app is open crosses from "upcoming" to "active" without a fetch.
  const [now, setNow] = useState(() => Date.now());
  const loaded = useRef(false);
  // The language actually on screen, not the phone's — somebody who picked
  // Tamil inside the app should be offered the operator's Tamil sentence.
  const { language } = useStrings();

  const refresh = useCallback(async () => {
    setNow(Date.now());
    // Two independent asks: an outage that breaks one of them should not take
    // the other down with it, and `allSettled` is what says so.
    const [policy, live] = await Promise.allSettled([
      PLATFORM === 'web' ? Promise.resolve(null) : fetchReleasePolicy(PLATFORM),
      fetchAppNotices(),
    ]);

    if (policy.status === 'fulfilled' && policy.value) {
      setRelease(policy.value);
      await AsyncStorage.setItem(POLICY_KEY, JSON.stringify(policy.value)).catch(() => undefined);
    }
    if (live.status === 'fulfilled') {
      setNotices(live.value);
      await AsyncStorage.setItem(NOTICES_KEY, JSON.stringify(live.value)).catch(() => undefined);
    }
    // A rejection is deliberately not handled beyond this: offline, or the
    // server is having a bad day. Neither is a reason to change what somebody
    // is allowed to do with their own ledger, so the cached answer stands.
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      // Cache first, so a blocked build stays blocked without a round trip and
      // a maintenance banner survives the launch that has no signal yet.
      await legacyKeysMigrated;
      const [cachedPolicy, cachedNotices, version, ids] = await Promise.all([
        AsyncStorage.getItem(POLICY_KEY).catch(() => null),
        AsyncStorage.getItem(NOTICES_KEY).catch(() => null),
        AsyncStorage.getItem(DISMISSED_KEY).catch(() => null),
        AsyncStorage.getItem(DISMISSED_NOTICES_KEY).catch(() => null),
      ]);
      if (!active) return;
      setRelease(readJson(cachedPolicy));
      setNotices(readJson(cachedNotices));
      setDismissedVersion(version);
      setDismissedNotices(readStringList(ids));
      loaded.current = true;
      await refresh();
    })();

    // Somebody who leaves the app open for a week should still find out, and a
    // maintenance window announced this morning should be live this afternoon.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && loaded.current) void refresh();
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [refresh]);

  const view = useMemo(
    () =>
      appState({
        installedVersion: INSTALLED,
        release,
        notices,
        platform: PLATFORM,
        country: deviceCountry(),
        locale: language,
        now,
        dismissedUpdateVersion: dismissedVersion,
        dismissedNoticeIds: dismissedNotices,
      }),
    [release, notices, now, language, dismissedVersion, dismissedNotices],
  );

  const dismissUpdate = useCallback(() => {
    const version = view.latestVersion;
    if (!version) return;
    setDismissedVersion(version);
    void AsyncStorage.setItem(DISMISSED_KEY, version).catch(() => undefined);
  }, [view.latestVersion]);

  const dismissNotice = useCallback((id: string) => {
    setDismissedNotices((previous) => {
      if (previous.includes(id)) return previous;
      // Bounded: the last fifty ids are far more than the table will ever hold
      // live at once, and an unbounded list is a leak nobody would notice.
      const next = [...previous, id].slice(-50);
      void AsyncStorage.setItem(DISMISSED_NOTICES_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const openStore = useCallback(() => {
    if (view.storeUrl) void Linking.openURL(view.storeUrl).catch(() => undefined);
  }, [view.storeUrl]);

  const value = useMemo<AppStatusValue>(
    () => ({
      ...view,
      installed: INSTALLED,
      now,
      dismissUpdate,
      dismissNotice,
      openStore,
      recheck: refresh,
    }),
    [view, now, dismissUpdate, dismissNotice, openStore, refresh],
  );

  return <AppStatusContext.Provider value={value}>{children}</AppStatusContext.Provider>;
}

export function useAppStatus(): AppStatusValue {
  const value = useContext(AppStatusContext);
  if (!value) throw new Error('useAppStatus must be used inside AppStatusProvider');
  return value;
}
