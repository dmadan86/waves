/**
 * The OS app-icon shortcuts (iOS Home-Screen Quick Actions / Android App
 * Shortcuts), kept behind a runtime check.
 *
 * All three are published, always: add an expense, scan a receipt, speak one —
 * the same three the home-screen widgets offer, so a long-press on the icon and
 * a widget lead to the same places. There is nothing to choose and nothing to
 * turn on; the menu is simply there.
 *
 * `expo-quick-actions` is a native module. On a JS-only reload of an older
 * dev-client — one built before the module was installed — reaching for it would
 * throw at launch. So nothing here imports it at module scope; every entry point
 * loads it lazily inside a try/catch and no-ops when it is not in the binary
 * (the same discipline the camera and scanner use).
 */

import { Platform } from 'react-native';

/** What an icon shortcut does. */
export type ShortcutAction = 'add' | 'scan' | 'voice';

/**
 * The menu, in the order it is shown. `add` leads because it is the plainest
 * thing somebody wants from a long-press, and the launcher puts the first item
 * nearest the icon.
 */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = ['add', 'scan', 'voice'];

/** The dynamic-quick-action ids we route on when the app is opened from one. */
const ID_PREFIX = 'waves.shortcut.';

const ICON: Record<ShortcutAction, string> = {
  // Symbol names resolve on iOS; Android falls back to no icon, which is fine.
  add: 'symbol:plus',
  scan: 'symbol:camera',
  voice: 'symbol:mic',
};

type QuickActionsModule = {
  setItems: (items: unknown[]) => Promise<void> | void;
  isSupported?: () => Promise<boolean> | boolean;
  initial?: { id?: string } | null;
  addListener?: (fn: (item: { id?: string }) => void) => { remove: () => void };
};

function load(): QuickActionsModule | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    // Lazy, guarded require: absent on a dev-client built before the module was
    // added, and we must not throw there.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-quick-actions') as {
      default?: QuickActionsModule;
    } & QuickActionsModule;
    return (mod.default ?? mod) as QuickActionsModule;
  } catch {
    return null;
  }
}

/** The action an icon-shortcut id stands for, or null if the id is not ours. */
export function actionForId(id: string): ShortcutAction | null {
  if (!id.startsWith(ID_PREFIX)) return null;
  const action = id.slice(ID_PREFIX.length);
  return (SHORTCUT_ACTIONS as readonly string[]).includes(action)
    ? (action as ShortcutAction)
    : null;
}

/**
 * Publish the three icon shortcuts. Called once the app's strings are known, and
 * again whenever the language changes, so the menu speaks the same language the
 * app does. A no-op without the native module.
 */
export async function syncQuickActions(titles: Record<ShortcutAction, string>): Promise<void> {
  const mod = load();
  if (!mod) return;
  try {
    await mod.setItems(
      SHORTCUT_ACTIONS.map((action) => ({
        id: `${ID_PREFIX}${action}`,
        title: titles[action],
        icon: ICON[action],
        params: { action },
      })),
    );
  } catch {
    // A device that cannot set shortcuts (an old OS, a launcher without support)
    // is not an error worth surfacing — every one of these places is reachable
    // from inside the app anyway.
  }
}

/** The action id the app was cold-launched with, if it was launched from the
 *  icon menu. Null otherwise (or without the module). */
export function initialQuickAction(): string | null {
  const mod = load();
  return mod?.initial?.id ?? null;
}

/** Subscribe to icon-shortcut taps while the app is already running. Returns a
 *  no-op unsubscribe when the module is absent. */
export function onQuickAction(fn: (id: string) => void): () => void {
  const mod = load();
  if (!mod?.addListener) return () => undefined;
  const sub = mod.addListener((item) => {
    if (item?.id) fn(item.id);
  });
  return () => sub.remove();
}
