/**
 * The app-icon quick shortcuts: publishes the three-item menu and routes a tap
 * on one of them.
 *
 * It handles both ways a tap arrives — a cold launch straight from the menu, and
 * a tap while the app is already open — and renders nothing at all. The menu
 * used to be a single action somebody had to choose in Settings, off until they
 * did; now all three are simply there, so there is no preference to read and
 * nothing to wait for.
 */

import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

import { useStrings } from '@/i18n';
import {
  actionForId,
  initialQuickAction,
  onQuickAction,
  routeForShortcut,
  syncQuickActions,
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

export function QuickShortcuts() {
  const { t } = useStrings();

  // Publish the menu, and re-publish it whenever the language changes so the
  // long-press menu never keeps the words of a language they have left.
  useEffect(() => {
    void syncQuickActions({ add: t.shortcut.add, scan: t.shortcut.scan, voice: t.shortcut.voice });
  }, [t]);

  useEffect(() => {
    void AsyncStorage.removeMany(RETIRED_KEYS).catch(() => undefined);
  }, []);

  // The cold-launch shortcut, consumed exactly once: `initialQuickAction()`
  // stays set for the life of the process, so without this guard any re-run of
  // the effect would fire it again.
  const consumedInitial = useRef(false);
  useEffect(() => {
    if (consumedInitial.current) return;
    consumedInitial.current = true;
    const initial = initialQuickAction();
    const action = initial ? actionForId(initial) : null;
    if (action) run(action);
  }, []);

  // Taps on the menu while the app is already open, independent of the
  // cold-launch guard above.
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
