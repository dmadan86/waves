/**
 * The app-icon quick shortcuts: the three-item menu, and what a tap on one does.
 *
 * Two components, because the two halves belong at different heights in the
 * tree. Publishing the menu has to happen wherever the app is — a person who
 * signed out, or has not got past the lock screen, still has an icon on their
 * home screen, and it must say the right thing. Acting on a tap has to happen
 * where there is somewhere to send them, which is inside the auth gate. Both
 * render nothing.
 */

import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/lib/auth';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import {
  actionForId,
  clearQuickActions,
  onQuickAction,
  routeForShortcut,
  syncQuickActions,
  takeInitialQuickAction,
  type ShortcutAction,
} from '@/lib/quickActions';

/** The keys the old "pick one shortcut, or off" preference wrote. Nothing reads
 *  them any more, so they are cleared once rather than left to sit in storage. */
const RETIRED_KEYS = ['shortcut.action', 'shortcut.doubleTap'];

function run(action: ShortcutAction): void {
  const route = routeForShortcut(action);
  if (route === '/voice' || route === '/capture') {
    router.push(route);
    return;
  }
  const scan = route.split('=')[1];
  router.push({ pathname: '/capture', params: { scan } });
}

/**
 * Publishes the menu for a signed-in account and clears it for everybody else.
 *
 * Mounted above the lock and the auth gate on purpose. The menu is a thing on
 * the home screen, not a thing in the app: it outlives every session, so the
 * moment somebody signs out it has to stop offering them the camera, and an
 * upgrade from the version that published one chosen shortcut has to replace
 * that entry whether or not this launch ever reaches the dashboard.
 */
export function QuickShortcutsMenu() {
  const { t } = useStrings();
  const { session, loading } = useAuth();

  // Re-publishes when the language changes, so the long-press menu never keeps
  // the words of a language somebody has left. `t` is one stable object per
  // language, so this is once per change and not once per render.
  useEffect(() => {
    // Nothing is published while the session is still being read: clearing on a
    // "not signed in yet" that is about to become a session would blank the menu
    // on every launch and put it back a moment later.
    if (loading) return;
    if (!session) {
      void clearQuickActions();
      // A launch nobody can act on ends here. The action is a constant for the
      // life of the process, so leaving it unclaimed would let it fire whenever
      // this person next signs in — long after the tap that meant it.
      takeInitialQuickAction();
      return;
    }
    void syncQuickActions({ add: t.shortcut.add, scan: t.shortcut.scan, voice: t.shortcut.voice });
  }, [t, session, loading]);

  useEffect(() => {
    void AsyncStorage.removeMany(RETIRED_KEYS).catch(() => undefined);
  }, []);

  return null;
}

/**
 * Routes a tap on one of the menu's three entries — both a cold launch straight
 * from the menu and a tap while the app is already open.
 *
 * Inside the auth gate, below the lock: a shortcut must not navigate past a
 * lock screen, and there is nowhere to send anybody until there is a session.
 */
export function QuickShortcutRouting() {
  // The cold-launch action, claimed on the first mount that can act on it.
  // There is no guard here on purpose: this component is unmounted and remounted
  // every time the app locks or the session changes, so a ref would reset with
  // it and fire the launch action again. `takeInitialQuickAction` holds the
  // once-per-process guard instead, and answers null every time after the first.
  useEffect(() => {
    const initial = takeInitialQuickAction();
    const action = initial ? actionForId(initial) : null;
    if (action) run(action);
  }, []);

  // Taps on the menu while the app is already open.
  useEffect(
    () =>
      onQuickAction((id) => {
        const action = actionForId(id);
        if (action) run(action);
      }),
    [],
  );

  return null;
}
