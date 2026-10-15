/**
 * The Google Play install referrer, read once per install.
 *
 * Native half: `modules/waves-install-referrer`, resolved optionally so a build
 * without it (iOS, web, an older dev client) reads null and never throws at
 * import time. iOS has no install referrer at all; there the friend pastes the
 * code from the web landing page into the invite screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { pendingReferral } from '@/lib/pendingReferral';
import {
  campaignFromInstallReferrer,
  captureInstallReferrer,
  type InstallCampaign,
} from '@/lib/referral';

interface NativeInstallReferrer {
  getInstallReferrer(): Promise<string | null>;
}

const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeInstallReferrer>('WavesInstallReferrer')
    : null;

const CHECKED_KEY = 'waves.installReferrerChecked';
/** The campaign tag the referrer carried, kept so an install that is only sent on a later launch still has it. */
const CAMPAIGN_KEY = 'waves.installCampaign';
/** Play's service can fail to ever call back; do not wait on it for the app's sake. */
const READ_TIMEOUT_MS = 8000;

async function readInstallReferrer(): Promise<string | null> {
  if (!native) return null;
  try {
    return await Promise.race([
      native.getInstallReferrer(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

/**
 * One read per process, shared by the referral-code capture and the install
 * event so the Play service is asked once. The campaign tag is saved as soon as
 * the answer is in (an empty one too), which is what lets a later launch send
 * `app_installed` with the right tag after the question was already asked.
 */
let sharedRead: Promise<string | null> | null = null;
function readOnce(): Promise<string | null> {
  sharedRead ??= (async () => {
    const raw = await readInstallReferrer();
    try {
      await AsyncStorage.setItem(CAMPAIGN_KEY, JSON.stringify(campaignFromInstallReferrer(raw)));
    } catch {
      // Unsaved: only a retried offline install loses its tag.
    }
    return raw;
  })();
  return sharedRead;
}

/**
 * The campaign tag for this install's `app_installed` event, or `{}`. Android
 * only (iOS has no install referrer). Waits for the referrer read, which gives
 * up after 8 seconds, so the install is still counted when Play never answers.
 */
export async function installCampaign(): Promise<InstallCampaign> {
  if (!native) return {};
  try {
    const stored = await AsyncStorage.getItem(CAMPAIGN_KEY);
    if (stored) return campaignFromInstallReferrer(toQuery(JSON.parse(stored)));
    return campaignFromInstallReferrer(await readOnce());
  } catch {
    return {};
  }
}

function toQuery(tag: unknown): string {
  if (typeof tag !== 'object' || tag === null) return '';
  const t = tag as Record<string, unknown>;
  return (['source', 'medium', 'campaign'] as const)
    .filter((k) => typeof t[k] === 'string')
    .map((k) => `utm_${k}=${String(t[k])}`)
    .join('&');
}

/** Android, first launch of this install: remember a referral code the Play link carried. */
export function captureInstallReferrerOnce(): Promise<string | null> {
  if (!native) return Promise.resolve(null);
  return captureInstallReferrer({
    read: readOnce,
    done: async () => (await AsyncStorage.getItem(CHECKED_KEY)) !== null,
    markDone: () => AsyncStorage.setItem(CHECKED_KEY, '1'),
    pending: pendingReferral,
  });
}
