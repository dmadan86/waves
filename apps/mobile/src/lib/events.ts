/**
 * First-party product analytics: a few anonymous app steps, kept in Waves' own
 * database.
 *
 * Four events only — an install, a sign-up started, onboarding finished, a
 * plans screen opened — because those are the steps the database cannot see
 * for itself. Everything else in the funnel is derived from rows that already
 * exist. See `eventsCore` for what may travel with an event, and the
 * `app_events` migration for the table and the rules the server re-applies.
 *
 * The install id is a random uuid made on this phone and kept in app storage.
 * It is not an advertising identifier, is not derived from the hardware, and
 * is never shared with anyone.
 *
 * `track` is fire-and-forget by contract: it returns nothing, never throws,
 * never waits on the network for its caller, and does nothing on web or in a
 * build with no backend. Analytics must never be the reason a screen is slow
 * or an app fails.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

import { backend, backendConfigured } from '@/lib/backend';
import { buildIdentity } from '@/lib/buildIdentity';
import { installCampaign } from '@/lib/installReferrer';

import { buildPayload, isInstallId, type EventName, type EventProps } from './eventsCore';

const INSTALL_ID_KEY = 'waves.analytics.installId';
const INSTALL_SENT_KEY = 'waves.analytics.installSent';

const enabled = Platform.OS !== 'web' && backendConfigured;

let installIdPromise: Promise<string> | null = null;

/** The phone's random install id, made on first use. Memoised for the process. */
function installId(): Promise<string> {
  installIdPromise ??= (async () => {
    try {
      const stored = await AsyncStorage.getItem(INSTALL_ID_KEY);
      if (isInstallId(stored)) return stored;
    } catch {
      // Fall through to a fresh id; storage refusing to answer is not fatal.
    }
    const fresh = randomUUID();
    try {
      await AsyncStorage.setItem(INSTALL_ID_KEY, fresh);
    } catch {
      // Unpersisted: this run still has a stable id, the next one starts over.
    }
    return fresh;
  })();
  return installIdPromise;
}

/** Sends one event. Resolves to whether the server accepted the call. */
async function send(name: EventName, props?: EventProps): Promise<boolean> {
  if (!enabled) return false;
  const payload = buildPayload({
    installId: await installId(),
    name,
    props,
    platform: Platform.OS,
    version: buildIdentity().version,
  });
  if (!payload) return false;
  const { error } = await backend.rpc('waves_track_event', payload);
  return !error;
}

export function track(name: EventName, props?: EventProps): void {
  try {
    void send(name, props).catch(() => {});
  } catch {
    // Never reaches the caller.
  }
}

/**
 * Where the install came from. iOS has no install referrer, so it is simply
 * the App Store (campaign links there are read in App Store Connect's App
 * Analytics, not in the app). Android carries the Play referrer's utm tag.
 * Never blocks past the referrer read's own timeout.
 */
async function installProps(): Promise<EventProps> {
  if (Platform.OS === 'ios') return { source: 'app_store' };
  return installCampaign();
}

/**
 * `app_installed`, once per install. The flag is only set after the server
 * took the event, so an offline first launch tries again on the next one; the
 * database keeps one per install either way.
 */
export function trackInstallOnce(): void {
  if (!enabled) return;
  void (async () => {
    try {
      if ((await AsyncStorage.getItem(INSTALL_SENT_KEY)) === '1') return;
      if (await send('app_installed', await installProps()))
        await AsyncStorage.setItem(INSTALL_SENT_KEY, '1');
    } catch {
      // Analytics never surfaces an error.
    }
  })();
}
