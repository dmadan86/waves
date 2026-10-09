/**
 * The OS app-icon shortcuts (iOS Home-Screen Quick Actions / Android App
 * Shortcuts) — which Waves no longer publishes.
 *
 * Earlier versions put three entries on a long-press of the icon (add an
 * expense, scan a receipt, speak one). They are gone: a long-press now shows
 * only the system's own entries, and the home-screen widgets are where those
 * three places live. But the OS keeps a published menu until the app replaces
 * it, so a phone upgrading from one of those versions would go on showing the
 * old entries. Every launch therefore clears the menu, which is all this file
 * still does.
 *
 * `expo-quick-actions` is a native module. On a JS-only reload of an older
 * dev-client — one built before the module was installed — reaching for it would
 * throw at launch. So it is never imported at module scope; it is loaded lazily
 * inside a try/catch and everything no-ops when it is not in the binary.
 */

import { Platform } from 'react-native';

type QuickActionsModule = {
  setItems: (items: unknown[]) => Promise<void> | void;
};

let cached: QuickActionsModule | null | undefined;

function load(): QuickActionsModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    // Lazy, guarded require: absent on a dev-client built before the module was
    // added, and we must not throw there.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-quick-actions') as {
      default?: QuickActionsModule;
    } & QuickActionsModule;
    cached = (mod.default ?? mod) as QuickActionsModule;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Stand a fake module in, for tests.
 *
 * The real one is reached through `require` so a bundle running on an older
 * binary degrades instead of crashing — and `require` is exactly what a test
 * runner cannot satisfy, so without this seam the only testable path would be
 * the one where the module is missing.
 */
export function setQuickActionsModuleForTests(module: QuickActionsModule | null | undefined): void {
  cached = module;
}

/**
 * Empty the long-press menu, so a phone that still carries the entries an older
 * version published loses them. A no-op without the native module, and quiet
 * on a launcher that will not take shortcuts.
 */
export async function clearQuickActions(): Promise<void> {
  const mod = load();
  if (!mod) return;
  try {
    await mod.setItems([]);
  } catch {
    // A launcher that will not take shortcuts has nothing to clear.
  }
}
