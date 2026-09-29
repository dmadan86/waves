/**
 * Phones stay upright; tablets and foldables may turn.
 *
 * The manifest no longer locks orientation (see
 * `plugins/withLargeScreenOrientation.js`), because Android 16 ignores that lock
 * on large screens and Play flags it. The phone layouts are still portrait
 * layouts, so the lock moves here, applied only below the 600dp shortest side
 * Android itself uses as the line between a phone and a large screen.
 */

import * as ScreenOrientation from 'expo-screen-orientation';
import { Dimensions, Platform } from 'react-native';

/** Android's large-screen line, in dp, on the screen's shorter side. */
const LARGE_SCREEN_DP = 600;

export function isLargeScreen(): boolean {
  const { width, height } = Dimensions.get('screen');
  return Math.min(width, height) >= LARGE_SCREEN_DP;
}

function apply(): void {
  const lock = isLargeScreen()
    ? ScreenOrientation.unlockAsync()
    : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  void lock.catch(() => {});
}

/**
 * Lock a phone to portrait, and keep deciding as the screen changes: a foldable
 * opened after launch becomes a large screen and is let go, and folded again it
 * is held upright. A no-op on web.
 */
export function holdPhonesUpright(): void {
  if (Platform.OS === 'web') return;
  apply();
  Dimensions.addEventListener('change', apply);
}
