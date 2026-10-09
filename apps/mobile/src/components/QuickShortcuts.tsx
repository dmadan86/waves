/**
 * Keeps the app-icon long-press menu empty of Waves' own entries.
 *
 * Waves used to publish three shortcuts there (add, scan, voice). It no longer
 * does — the home-screen widgets carry those — but the OS keeps whatever an app
 * last published, so a phone upgrading from one of those versions still shows
 * them until something clears them. This clears them on every launch, signed in
 * or not, which is why it is mounted above the lock and the auth gate. It
 * renders nothing.
 */

import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearQuickActions } from '@/lib/quickActions';

/** The keys the old "pick one shortcut, or off" preference wrote. Nothing reads
 *  them any more, so they are cleared once rather than left to sit in storage. */
const RETIRED_KEYS = ['shortcut.action', 'shortcut.doubleTap'];

export function QuickShortcutsMenu() {
  useEffect(() => {
    void clearQuickActions();
    void AsyncStorage.removeMany(RETIRED_KEYS).catch(() => undefined);
  }, []);

  return null;
}
