/**
 * Updating the app from inside the app.
 *
 * **Android** uses Google Play's in-app updates: the bar's "Update" opens Play's
 * own "Update available" sheet, the download runs in the background while the
 * app stays usable, and once it has finished the bar offers "Restart" — Play
 * installs and the app comes back on the new version. The person chooses the
 * moment; nothing is installed out from under them mid-expense. The native half
 * is `modules/waves-store-update`, resolved optionally so a build without it is
 * simply a build with no bar.
 *
 * **iOS** has no in-app updates. It asks the App Store for the newest version
 * of this app and, when that is newer than the running build, the bar's
 * "Update" opens the store page. That is as far as Apple lets an app go.
 *
 * Checked on launch and every time the app comes back to the foreground. A
 * "Not now" holds for that version only — the bar comes back when there is
 * something newer — and lives in AsyncStorage on this device. A download in
 * progress, or a finished one, is never hidden.
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
import { requireOptionalNativeModule } from 'expo';
import { AppState, Linking, Platform } from 'react-native';

import { deviceCountry } from '@/i18n';
import {
  isPutOff,
  newerStoreVersion,
  NO_UPDATE,
  phaseAfter,
  phaseFromCheck,
  type PlayStatusEvent,
  type PlayUpdateInfo,
  type UpdatePhase,
} from '@/lib/storeUpdatePhase';

interface NativeStoreUpdate {
  check(): Promise<PlayUpdateInfo | null>;
  start(immediate: boolean): Promise<boolean>;
  complete(): Promise<boolean>;
  addListener(event: 'onStatus', listener: (event: PlayStatusEvent) => void): { remove(): void };
}

const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeStoreUpdate>('WavesStoreUpdate')
    : null;

/** The app's App Store record (`ascAppId` in eas.json). */
const APP_STORE_ID = '6813446645';
const IOS_BUNDLE_ID = 'app.wavs.mobile';
const APP_STORE_URL = `itms-apps://apps.apple.com/app/id${APP_STORE_ID}`;

const DISMISSED_KEY = 'waves.storeUpdate.dismissed';

interface StoreUpdateValue {
  /** What the bar should show, already net of a "Not now" for this version. */
  readonly phase: UpdatePhase;
  /** Start the update: Play's sheet on Android, the store page on iOS. */
  readonly update: () => void;
  /** Install a downloaded update and restart (Android). */
  readonly restart: () => void;
  /** Put this version's offer away. */
  readonly dismiss: () => void;
}

const StoreUpdateContext = createContext<StoreUpdateValue>({
  phase: NO_UPDATE,
  update: () => {},
  restart: () => {},
  dismiss: () => {},
});

export function useStoreUpdate(): StoreUpdateValue {
  return useContext(StoreUpdateContext);
}

async function checkAppStore(): Promise<UpdatePhase> {
  try {
    const country = (deviceCountry() ?? 'IN').toLowerCase();
    const response = await fetch(
      `https://itunes.apple.com/lookup?bundleId=${IOS_BUNDLE_ID}&country=${country}`,
    );
    if (!response.ok) return NO_UPDATE;
    const version = newerStoreVersion(Constants.expoConfig?.version ?? null, await response.json());
    return version ? { kind: 'available', version } : NO_UPDATE;
  } catch {
    return NO_UPDATE;
  }
}

/**
 * What the store says right now, or null when it could not be asked (no Play
 * module in this build, offline) — which leaves whatever is showing alone.
 */
async function askStore(): Promise<UpdatePhase | null> {
  if (Platform.OS === 'ios') return checkAppStore();
  if (!native) return null;
  try {
    return phaseFromCheck(await native.check());
  } catch {
    return null;
  }
}

export function StoreUpdateProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<UpdatePhase>(NO_UPDATE);
  const [dismissed, setDismissed] = useState<string | null>(null);
  /** Only the newest check may land: an older answer is out of date. */
  const checks = useRef(0);
  /** Ask the store, then show what it said. Never rejects. */
  const check = useCallback(() => {
    const id = ++checks.current;
    void askStore().then((next) => {
      if (!next || id !== checks.current) return;
      // A check never undoes a download this session is already following, or
      // one that has finished while the check was in flight.
      setPhase((current) =>
        (current.kind === 'downloading' || current.kind === 'ready') && next.kind === 'available'
          ? current
          : next,
      );
    });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(DISMISSED_KEY)
      .then(setDismissed)
      .catch(() => {});
    check();
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    const status = native?.addListener('onStatus', (event) => {
      setPhase((current) => phaseAfter(current, event));
    });
    return () => {
      app.remove();
      status?.remove();
    };
  }, [check]);

  const update = useCallback(() => {
    if (Platform.OS === 'ios') {
      void Linking.openURL(APP_STORE_URL).catch(() => undefined);
      return;
    }
    void native
      ?.start(false)
      .then((started) => {
        // Play said no to starting (the offer went stale): ask again.
        if (!started) check();
      })
      .catch(() => undefined);
  }, [check]);

  const restart = useCallback(() => {
    void native
      ?.complete()
      .then((installing) => {
        // Play could not start the install: ask again, so the bar says what is true.
        if (!installing) check();
      })
      .catch(() => undefined);
  }, [check]);

  const dismiss = useCallback(() => {
    if (phase.kind !== 'available') return;
    const { version } = phase;
    setDismissed(version);
    void AsyncStorage.setItem(DISMISSED_KEY, version).catch(() => {});
  }, [phase]);

  const value = useMemo<StoreUpdateValue>(
    () => ({
      phase: isPutOff(phase, dismissed) ? NO_UPDATE : phase,
      update,
      restart,
      dismiss,
    }),
    [phase, dismissed, update, restart, dismiss],
  );

  return <StoreUpdateContext.Provider value={value}>{children}</StoreUpdateContext.Provider>;
}
