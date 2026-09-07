/**
 * The OS app-icon shortcuts (iOS Home-Screen Quick Actions / Android App
 * Shortcuts), kept behind a runtime check.
 *
 * All three are published together: add an expense, scan a receipt, speak one —
 * the same three the home-screen widgets offer, so a long-press on the icon and
 * a widget lead to the same places. There is nothing to choose and nothing to
 * turn on; the menu is simply there. The one condition is a signed-in account:
 * every one of these places is behind the door, so the menu is cleared when
 * somebody signs out rather than offering them a screen they cannot reach.
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

let cached: QuickActionsModule | null | undefined;

/** Whether this process has already handed over its launch action. See
 *  `takeInitialQuickAction`. */
let launchTaken = false;

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
 * the one where the module is missing. The same seam `nativeGoogle` uses.
 */
export function setQuickActionsModuleForTests(module: QuickActionsModule | null): void {
  cached = module;
  launchTaken = false;
}

/** The action an icon-shortcut id stands for, or null if the id is not ours. */
export function actionForId(id: string): ShortcutAction | null {
  if (!id.startsWith(ID_PREFIX)) return null;
  const action = id.slice(ID_PREFIX.length);
  return (SHORTCUT_ACTIONS as readonly string[]).includes(action)
    ? (action as ShortcutAction)
    : null;
}

/** Destination for each app-icon shortcut. */
export function routeForShortcut(action: ShortcutAction, now = Date.now()): string {
  switch (action) {
    case 'scan':
      return `/capture?scan=${now}`;
    case 'voice':
      return '/voice';
    default:
      return '/capture';
  }
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

/** Clear the menu. Called when nobody is signed in, so a long-press never
 *  offers a place the app cannot take them. A no-op without the module. */
export async function clearQuickActions(): Promise<void> {
  const mod = load();
  if (!mod) return;
  try {
    await mod.setItems([]);
  } catch {
    // Same as above: a launcher that will not take shortcuts is not an error.
  }
}

/**
 * The action id the app was cold-launched with, handed over exactly once.
 *
 * The module's `initial` is a constant for the life of the process — it is read
 * from the launch intent and never cleared — while the component that acts on
 * it is mounted and unmounted repeatedly: the lock screen and the auth gate
 * both swap the whole tree out. A guard held in that component (a ref, say)
 * therefore resets on every unlock and every sign-in, and the launch action
 * would fire again hours after the launch. So the guard lives here, with the
 * value it guards, and the process gets one.
 *
 * Whoever cannot act on it still takes it: a launch that lands on the sign-in
 * screen calls this and drops the answer, so signing in an hour later does not
 * suddenly open the camera.
 */
export function takeInitialQuickAction(): string | null {
  if (launchTaken) return null;
  launchTaken = true;
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
