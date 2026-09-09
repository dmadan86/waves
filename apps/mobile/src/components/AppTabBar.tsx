/**
 * The one bottom bar, shown on every screen — not just the tab screens.
 *
 * The destinations live in the `(tabs)` group, but most of the app is pushed on
 * top of it (a group, a settings page, the inbox), and a bar that only lived
 * inside the tabs navigator vanished the moment you went anywhere. This renders
 * once at the root, over the whole navigation stack, so the bar stays put
 * wherever you are — WhatsApp keeps its bar the same way.
 *
 * It hides itself on the routes where a bar would be wrong (see `resolveTabBar`):
 * the full-screen camera and the rise-from-bottom modals, and the signed-out
 * screens. The account is reached from the header avatar rather than a tab, so
 * it is not one of the bar's destinations.
 *
 * The raised mic in the middle takes two gestures, not one. Tap it and the
 * voice screen opens and listens, as it always has. *Hold* it and it becomes a
 * walkie-talkie: the screen opens the instant the finger lands, you talk while
 * you hold, and lifting ends the sentence — the gesture everybody already has
 * from a voice note. The rules of that hold live in `lib/pushToTalk`; what is
 * here is the finger. Nothing is reachable only by holding, because a
 * hold-only control is no control at all to a screen reader.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useGlobalSearchParams, useSegments } from 'expo-router';
import { Platform, Vibration } from 'react-native';

import { iconSize, PillTabBar, type PillTabAction, type PillTabItem } from '@waves/ui';

import { isRtl, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { router, switchTab } from '@/lib/navigation';
import { pushToTalk } from '@/lib/pushToTalk';
import { resolveTabBar, tabBarRouteForSelection } from '@/lib/tabBar';

/**
 * How far the finger has to slide off the mic to call the whole thing off.
 *
 * WhatsApp's escape from a hold started by accident, and the only one people
 * already know. Far enough that the wobble of holding a phone one-handed never
 * reaches it, near enough to be an easy flick.
 */
const CANCEL_DISTANCE = 72;

/**
 * A short buzz under the finger — Android only.
 *
 * A press-to-talk control that answers silently feels broken: there is no click
 * and, while the screen is still arriving, nothing to look at either. React
 * Native's own `Vibration` is the whole haptics vocabulary this app has, and it
 * is enough on Android, where the duration is honoured and 15ms reads as a tick.
 * iOS ignores the duration and buzzes the entire phone, which is far too much
 * for a button press — a real iOS haptic needs `expo-haptics`, a native module,
 * so it waits for a build rather than riding this change.
 */
function buzz(ms: number): void {
  if (Platform.OS !== 'android') return;
  Vibration.vibrate(ms);
}

/** Renders the persistent bottom navigation bar and routes tab selections without stacking duplicates. */
export function AppTabBar() {
  const { t } = useStrings();
  const { session } = useAuth();
  // `useSegments` is typed as a union of fixed-length route tuples, so indexing
  // past the first element trips the tuple bounds check under the CI tsconfig.
  // We only ever read positions generically, so widen to a plain string array.
  const segments = useSegments() as readonly string[];
  // When the bar is showing over a group's own screens, the mic should speak
  // *into that group*, not the unassigned inbox. `useSegments` gives the route
  // shape (`group/[id]/…`); the id's value comes from the focused route's
  // params. Any non-group screen leaves this null and the mic opens plain.
  const params = useGlobalSearchParams<{ id?: string }>();
  const groupId = segments[0] === 'group' && typeof params.id === 'string' ? params.id : null;

  // No session means no bar anywhere — the privacy page opened from the login
  // legal line is the one place it used to leak onto a signed-out screen.
  const { hidden, activeKey } = resolveTabBar(segments, !session);

  const items = useMemo<PillTabItem[]>(
    () => [
      {
        key: 'index',
        label: t.home,
        icon: (color) => <Ionicons name="home" size={iconSize.lg} color={color} />,
      },
      {
        key: 'friends',
        label: t.friends,
        icon: (color) => <Ionicons name="people" size={iconSize.lg} color={color} />,
      },
      {
        key: 'activity',
        label: t.activity,
        icon: (color) => <Ionicons name="pulse" size={iconSize.lg} color={color} />,
      },
      {
        key: 'me',
        label: t.personal.tab,
        icon: (color) => <Ionicons name="wallet-outline" size={iconSize.lg} color={color} />,
      },
    ],
    [t.activity, t.friends, t.home, t.personal.tab],
  );

  // All bar destinations are tabs now. `navigate` switches to the existing tab
  // route instead of stacking a second copy; tapping the active tab is a no-op
  // so repeated taps do not schedule redundant router work.
  const go = useCallback(
    (key: string): void => {
      const route = tabBarRouteForSelection(activeKey, key);
      if (route) switchTab(route);
    },
    [activeKey],
  );

  // A finger is down on the mic. Held in state for one reason beyond the render:
  // the bar hides itself on the `voice` route, and unmounting the button the
  // finger is resting on would throw the release away — no press-out, no way to
  // know the sentence had finished. So while a hold is running the bar stays,
  // over the voice screen, under the thumb that opened it.
  const [holding, setHolding] = useState(false);
  // This hold has already been called off by a slide, so the lift that follows
  // is not a "send". Reset by the next press, never by the press-out it silences.
  const cancelled = useRef(false);

  const openVoice = useCallback((): void => {
    router.push(groupId ? { pathname: '/voice', params: { group: groupId } } : '/voice');
  }, [groupId]);

  // The finger has landed: open the voice screen *now*. The mic on that screen
  // starts itself as it mounts, so this is the earliest the recogniser can
  // possibly be live — earlier than today's tap, which waits for the lift.
  const holdStart = useCallback((): void => {
    cancelled.current = false;
    pushToTalk.begin();
    setHolding(true);
    buzz(15);
    openVoice();
  }, [openVoice]);

  // The finger has lifted. A press too brief to have carried any speech is
  // reported as a plain tap and changes nothing — the screen is open and still
  // listening, which is exactly what a tap has always done.
  const holdEnd = useCallback((): void => {
    setHolding(false);
    if (cancelled.current) return;
    if (pushToTalk.release() === 'send') buzz(15);
  }, []);

  // Sliding off the button abandons the whole thing, the way it does on a voice
  // note. Which way is "off" follows the writing direction: the gesture reads as
  // sweeping the message away, and in Arabic that sweep goes the other way.
  const holdMove = useCallback(({ dx }: { dx: number; dy: number }): void => {
    if (cancelled.current) return;
    const away = isRtl() ? dx : -dx;
    if (away < CANCEL_DISTANCE) return;
    cancelled.current = true;
    setHolding(false);
    pushToTalk.cancel();
    // Two beats, so calling it off never feels like sending it.
    buzz(30);
  }, []);

  // The raised mic: speak an expense from anywhere the bar is showing. The
  // button is a black circle, so the mic wears the on-brand (white) colour the
  // bar hands it. Tap to open and speak, or hold and talk — the hold is a
  // shortcut over the same screen, so nothing is reachable only by holding.
  const voice = useMemo<PillTabAction>(
    () => ({
      accessibilityLabel: t.voice.speakExpense,
      accessibilityHint: t.voice.micHint,
      onPress: openVoice,
      onPressIn: holdStart,
      onPressOut: holdEnd,
      onHoldMove: holdMove,
      icon: (color: string) => <Ionicons name="mic" size={iconSize.lg} color={color} />,
    }),
    [holdEnd, holdMove, holdStart, openVoice, t.voice.micHint, t.voice.speakExpense],
  );

  // Hidden, unless a hold is running — see `holding` above.
  if (hidden && !holding) return null;

  return (
    <PillTabBar items={items} activeKey={activeKey} onSelect={go} animated centerAction={voice} />
  );
}
