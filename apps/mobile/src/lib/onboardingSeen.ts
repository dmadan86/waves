/**
 * Who has already met the three intro cards.
 *
 * The flag used to be a single device-wide key: whoever finished — or skipped —
 * the tour on this phone answered for every account that would ever sign in
 * here afterwards. That is why the tour stopped appearing after login. The
 * screen never went anywhere and the gate never changed; the phone had simply
 * already said "seen" on behalf of everybody, and nothing clears that, not even
 * signing out.
 *
 * A tour is shown to a *person* meeting the app, not to a handset, so the flag
 * is filed per account id — the same shape the backup recovery key and the
 * cloud tokens already use.
 *
 * The old device-wide key is still read, once, and claimed by the first account
 * that asks: that account is the one that saw the tour, so it keeps not seeing
 * it, and the key is then removed so a second, genuinely new account on the
 * same phone is treated as new. A phone that already had two accounts signed in
 * pays for that with one repeat of the tour on the second of them — three
 * swipes, and only ever once.
 *
 * Nothing in here rejects. Storage refusing a read is not a reason to trap
 * somebody behind an intro, so a failure reports "seen" and they miss a tour
 * rather than meeting a wall.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { legacyKeysMigrated } from '@/lib/legacyKeys';

/**
 * The pre-account key: one phone, one answer. Read until an account claims it,
 * never written again. Kept verbatim so a device that saw the tour under the
 * old scheme is recognised rather than re-toured.
 */
const DEVICE_KEY = 'waves.onboarding_seen';

/** Where the answer lives now — one slot per signed-in account. */
const slotFor = (ownerId: string): string => `${DEVICE_KEY}.${ownerId}`;

/** Has this account already been shown the intro? Never rejects. */
export async function onboardingSeen(ownerId: string): Promise<boolean> {
  try {
    // The rename moved `baaki.onboarding_seen` onto the device key. Reading
    // before that has landed would call a returning phone a new one.
    await legacyKeysMigrated;

    if ((await AsyncStorage.getItem(slotFor(ownerId))) === 'yes') return true;
    if ((await AsyncStorage.getItem(DEVICE_KEY)) !== 'yes') return false;

    // Claimed: this account inherits the phone's old answer, and the phone
    // stops answering for anybody else.
    await AsyncStorage.setItem(slotFor(ownerId), 'yes');
    await AsyncStorage.removeItem(DEVICE_KEY);
    return true;
  } catch {
    return true;
  }
}

/** Remember that this account is done with the intro. Never rejects. */
export async function rememberOnboardingSeen(ownerId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(slotFor(ownerId), 'yes');
  } catch {
    // A write that fails costs them one repeat of the tour, not a stuck screen.
  }
}
