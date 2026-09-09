/**
 * Carrying a phone's own storage across the rename.
 *
 * Everything the app keeps on the device is filed under a key that used to
 * start with the old name — the chosen language, the theme, the app-lock
 * setting, the device id that the two-device cap counts, and (on web) the
 * mirror, its cursors and the unsent queue. Renaming those keys in the source
 * is a one-line change and a silent wipe on every phone that already has the
 * app: the ledger's pending writes stop existing, the lock turns itself off,
 * and a device that was already counted asks for a second seat.
 *
 * So the rename moves the values, once, before anything reads them. A move is
 * only ever made into an empty slot: if the new key already holds something —
 * the app has run since the rename, or the person changed the setting before
 * this ran — the old value is stale and gets dropped rather than allowed to
 * overwrite. That makes the whole pass idempotent and safe to run at every
 * launch, which is what it does.
 *
 * A few keys are swept away here instead of moved — see `RETIRED` below. They
 * are the ones whose meaning has gone, not just their name.
 *
 * `legacyKeysMigrated` is the promise every reader of a moved key awaits. It is
 * created at import time and settles once per process; awaiting it a dozen
 * times costs nothing after the first. It never rejects — a device whose
 * keychain refuses a read is a device that starts fresh, which is bad, and an
 * app that will not launch is worse.
 *
 * Nothing native is imported at the top of this file. The web sync driver
 * awaits it, and that driver is covered by tests that run in plain Node, where
 * a static `react-native` import fails to parse before a single line runs. The
 * keychain is reached for through a dynamic import that is allowed to fail, per
 * the same rule every other native module in here follows.
 *
 * The mirror's own encryption key (`waves.mirror.dek.v1`) is deliberately
 * absent: it was written under the new name from the day it existed, and the
 * renamed database file still decrypts with it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

interface Move {
  readonly from: string;
  readonly to: string;
  /** Kept in the keychain on a phone; there is no keychain on web. */
  readonly secure?: boolean;
}

const MOVES: readonly Move[] = [
  { from: 'baaki.language', to: 'waves.language' },
  { from: 'baaki.theme_scheme', to: 'waves.theme_scheme' },
  { from: 'baaki.sync_network', to: 'waves.sync_network' },
  { from: 'baaki.session_replay_consent', to: 'waves.session_replay_consent' },
  { from: 'baaki.release_policy', to: 'waves.release_policy' },
  { from: 'baaki.update_dismissed', to: 'waves.update_dismissed' },
  // The web driver's whole local store, including writes that have not synced.
  { from: 'baaki:mirror', to: 'waves:mirror' },
  { from: 'baaki:cursors', to: 'waves:cursors' },
  { from: 'baaki:queue', to: 'waves:queue' },
  { from: 'baaki:drafts', to: 'waves:drafts' },
  { from: 'baaki.device.id', to: 'waves.device.id', secure: true },
  { from: 'baaki.app_lock_enabled', to: 'waves.app_lock_enabled', secure: true },
  { from: 'baaki.app_lock_grace_seconds', to: 'waves.app_lock_grace_seconds', secure: true },
];

/**
 * Keys that are deleted rather than moved, because nothing reads them any more.
 *
 * All three held "somebody on this handset has already been shown the intro"
 * (or the coach-marks) — one device-wide answer, given on behalf of every
 * account that would ever sign in here. That is the bug `lib/onboardingSeen`
 * exists to end: the answer belongs to an account now, and a phone does not get
 * to give it. So the old values are not migrated, not claimed and not
 * consulted; they are swept up, and every account is asked once for itself.
 *
 * Sweeping is what makes it safe. A retired key is never read again, so a
 * delete that fails is an orphaned string and nothing more — it cannot come
 * back as an answer, and it cannot be re-created by the moves above, because
 * `baaki.onboarding_seen` is no longer one of them. (Leaving it a move and
 * deleting the destination elsewhere would have resurrected it: `apply` rewrites
 * the destination whenever it finds it empty, so a source whose `forget` had
 * failed would re-answer on the next launch, and every launch after that.)
 */
const RETIRED: readonly string[] = [
  'baaki.onboarding_seen',
  'waves.onboarding_seen',
  // Never had a `baaki.` spelling — it was born after the rename — so the one
  // name is the whole of it.
  'waves.tour_seen_v1',
];

const onWeb = typeof document !== 'undefined';

type SecureStoreModule = typeof import('expo-secure-store');

let keychain: Promise<SecureStoreModule | null> | null = null;

/** The keychain, or null where there is not one. Never throws. */
function secureStore(): Promise<SecureStoreModule | null> {
  keychain ??= onWeb ? Promise.resolve(null) : import('expo-secure-store').catch(() => null);
  return keychain;
}

async function read(move: Move, key: string): Promise<string | null> {
  try {
    if (move.secure !== true) return await AsyncStorage.getItem(key);
    const store = await secureStore();
    return store ? await store.getItemAsync(key) : null;
  } catch {
    return null;
  }
}

async function write(move: Move, key: string, value: string): Promise<void> {
  if (move.secure !== true) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  const store = await secureStore();
  if (!store) throw new Error('no keychain');
  await store.setItemAsync(key, value);
}

async function forget(move: Move, key: string): Promise<void> {
  try {
    if (move.secure !== true) {
      await AsyncStorage.removeItem(key);
      return;
    }
    const store = await secureStore();
    await store?.deleteItemAsync(key);
  } catch {
    // A value that will not delete is a value that gets skipped next launch,
    // because by then the new key holds something. Harmless either way.
  }
}

async function apply(move: Move): Promise<void> {
  const previous = await read(move, move.from);
  if (previous === null) return;
  const current = await read(move, move.to);
  if (current === null) {
    try {
      await write(move, move.to, previous);
    } catch {
      // Leave the old key in place so the next launch can try again.
      return;
    }
  }
  await forget(move, move.from);
}

async function retire(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Nothing reads it, so a key that will not delete is wasted bytes rather
    // than a wrong answer. The next launch tries again.
  }
}

async function migrate(): Promise<void> {
  await Promise.all([
    ...MOVES.map((move) => apply(move).catch(() => {})),
    ...RETIRED.map((key) => retire(key)),
  ]);
}

/**
 * Settles once the device's pre-rename keys have been moved and its retired
 * ones swept. Never rejects.
 */
export const legacyKeysMigrated: Promise<void> = migrate();
