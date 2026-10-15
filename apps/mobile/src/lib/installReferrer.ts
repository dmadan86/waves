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
import { captureInstallReferrer } from '@/lib/referral';

interface NativeInstallReferrer {
  getInstallReferrer(): Promise<string | null>;
}

const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeInstallReferrer>('WavesInstallReferrer')
    : null;

const CHECKED_KEY = 'waves.installReferrerChecked';
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

/** Android, first launch of this install: remember a referral code the Play link carried. */
export function captureInstallReferrerOnce(): Promise<string | null> {
  if (!native) return Promise.resolve(null);
  return captureInstallReferrer({
    read: readInstallReferrer,
    done: async () => (await AsyncStorage.getItem(CHECKED_KEY)) !== null,
    markDone: () => AsyncStorage.setItem(CHECKED_KEY, '1'),
    pending: pendingReferral,
  });
}
