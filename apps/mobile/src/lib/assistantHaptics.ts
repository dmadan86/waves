/**
 * The assistant's haptics: a tick on a chip, a success buzz on "Saved with…",
 * a light tap on Undo.
 *
 * `expo-haptics` is a native module, so it is loaded the way `AppTabBar` loads
 * its optional pieces: inside a try, once, and a build or a platform without it
 * simply stays quiet. Nothing here ever throws or waits; a haptic is a garnish.
 * The web has none.
 */

import { Platform } from 'react-native';

interface HapticsModule {
  selectionAsync: () => Promise<void>;
  notificationAsync: (type: unknown) => Promise<void>;
  impactAsync: (style: unknown) => Promise<void>;
  NotificationFeedbackType: { Success: unknown };
  ImpactFeedbackStyle: { Light: unknown };
}

let cached: HapticsModule | null | undefined;

/** Reads the native module. Replaceable so a test can stand in for it. */
let loadModule: () => unknown = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('expo-haptics');

function load(): HapticsModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web') {
    cached = null;
    return cached;
  }
  try {
    const mod = loadModule() as Partial<HapticsModule>;
    cached =
      typeof mod.selectionAsync === 'function' &&
      typeof mod.notificationAsync === 'function' &&
      typeof mod.impactAsync === 'function' &&
      mod.NotificationFeedbackType &&
      mod.ImpactFeedbackStyle
        ? (mod as HapticsModule)
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

function run(play: (haptics: HapticsModule) => Promise<void>): void {
  try {
    const haptics = load();
    if (haptics) void play(haptics).catch(() => undefined);
  } catch {
    // Never reaches the caller.
  }
}

/** A chip was tapped. */
export function hapticSelect(): void {
  run((h) => h.selectionAsync());
}

/** Something was saved. */
export function hapticSuccess(): void {
  run((h) => h.notificationAsync(h.NotificationFeedbackType.Success));
}

/** Undo was tapped. */
export function hapticLight(): void {
  run((h) => h.impactAsync(h.ImpactFeedbackStyle.Light));
}

/** Test seam: forget the loaded module, and optionally supply a stand-in for it. */
export function resetHapticsForTest(loader?: () => unknown): void {
  cached = undefined;
  if (loader) loadModule = loader;
}
