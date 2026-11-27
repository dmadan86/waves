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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useGlobalSearchParams, useSegments } from 'expo-router';
import { AppState, BackHandler, Platform, Vibration, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BAR_HEIGHT,
  CenterButton,
  FAB_GAP,
  iconSize,
  PillTabBar,
  setTabBarFab,
  useTheme,
  type PillTabAction,
  type PillTabItem,
} from '@waves/ui';

import { useCaptures, useVoiceAgentStatus } from '@/data/hooks';
import { UpdateBar } from '@/components/UpdateBar';
import { isRtl, plural, useStrings } from '@/i18n';
import { useAuth, useViewerId } from '@/lib/auth';
import { foldedCaptureCount } from '@/lib/captureBatch';
import { captureInboxActionState } from '@/lib/dashboardActions';
import {
  companyActiveKey,
  companyBackRoute,
  companyBarActiveKey,
  companyBarRoute,
  isCompanyBarRoot,
  isCompanyMode,
  isCompanyTabRoot,
  reviewSlotKey,
} from '@/lib/companyTab';
import { useCompanySuspended } from '@/data/companyEntries';
import { usePendingCount } from '@/lib/companyPending';
import { useViewerCompanyIds, useViewerRole } from '@/lib/useCompanyTab';
import { router, runBarMove, setBackOverride, switchTab } from '@/lib/navigation';
import { installTabBack, type TabBackDeps } from '@/lib/tabBack';
import { useFabOverride } from '@/lib/fabOverride';
import { fabDrawn } from '@/lib/personalLayoutRules';
import { companyTabTarget, readLastSpace } from '@/lib/spaces';
import { useFollowSpace } from '@/lib/useSpaces';
import { pushToTalk } from '@/lib/pushToTalk';
import { HoldVoiceHost } from '@/components/voice/HoldVoiceHost';
import { holdMicState, refreshHoldMic } from '@/lib/holdMic';
import { holdPlan } from '@/lib/holdVoicePure';
import { useVoiceConsent } from '@/lib/voiceConsentStore';
import {
  isNestedPersonal,
  isPersonalMode,
  isPersonalRoot,
  isTabRoot,
  personalActiveKey,
  personalBackRoute,
  personalBarAction,
  personalRouteForSelection,
  showFab,
  resolveTabBar,
  tabBarRouteForSelection,
} from '@/lib/tabBar';
import {
  householdBackRoute,
  householdBarActiveKey,
  barMove,
  householdBarRoute,
  isHouseholdBarRoot,
} from '@/lib/householdTab';
import { useHouseholdMode } from '@/lib/useHouseholdMode';
import { useTabBarSuppressed } from '@/lib/tabBarSuppress';
import { useVoiceWarmup } from '@/lib/voiceWarmup';

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

/** Each item reads the same clock, so a stagger never schedules React work. */
function ModeItem({
  children,
  p,
  index,
  personal,
  reduced,
  focused,
}: {
  children: ReactNode;
  p: SharedValue<number>;
  index: number;
  personal: boolean;
  reduced: boolean;
  focused: boolean;
}) {
  const focus = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    focus.value = reduced ? (focused ? 1 : 0) : withTiming(focused ? 1 : 0, { duration: 160 });
  }, [focus, focused, reduced]);
  const style = useAnimatedStyle(() => {
    const progress = reduced
      ? p.value
      : interpolate(
          p.value,
          personal ? [(index * 30) / 280, (index * 30 + 140) / 280] : [0, 0.5],
          [0, 1],
          Extrapolation.CLAMP,
        );
    const visible = personal ? progress : 1 - progress;
    return {
      opacity: reduced ? 1 : visible * (0.92 + focus.value * 0.08),
      transform: reduced
        ? []
        : [{ translateY: (1 - visible) * 10 }, { scale: 1 + focus.value * 0.035 }],
    };
  });
  return (
    <Animated.View style={[{ flex: 1, justifyContent: 'center' }, style]}>{children}</Animated.View>
  );
}

/** Renders the persistent bottom navigation bar and routes tab selections without stacking duplicates. */
const tabBackDeps: TabBackDeps = {
  setOverride: setBackOverride,
  addHardwareBack: (handler) => BackHandler.addEventListener('hardwareBackPress', handler),
};

export function AppTabBar() {
  const { t, locale } = useStrings();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  // The bar carries the mic, so it is where the mic's slow answers are fetched
  // ahead of the tap: the voice screen then opens straight onto a live mic.
  useVoiceWarmup();
  useFollowSpace();
  // `useSegments` is typed as a union of fixed-length route tuples, so indexing
  // past the first element trips the tuple bounds check under the CI tsconfig.
  // We only ever read positions generically, so widen to a plain string array.
  const segments = useSegments() as readonly string[];
  // When the bar is showing over a group's own screens, the mic should speak
  // *into that group*, not the unassigned inbox. `useSegments` gives the route
  // shape (`group/[id]/…`); the id's value comes from the focused route's
  // params. Any non-group screen leaves this null and the mic opens plain.
  const params = useGlobalSearchParams<{
    id?: string;
    view?: string;
    tab?: string;
    hh?: string;
    space?: string;
    returnTo?: string;
  }>();
  const groupId = segments[0] === 'group' && typeof params.id === 'string' ? params.id : null;

  // No session means no bar anywhere — the privacy page opened from the login
  // legal line is the one place it used to leak onto a signed-out screen.
  const { hidden, activeKey: sharedKey } = resolveTabBar(segments, !session);
  // On the Personal tab and its screens the bar swaps to the private-money
  // destinations (same look, same mic); leaving them swaps it back. Route-derived.
  const personal = isPersonalMode(segments, params.space);
  // Company mode: an owner or manager inside their own company gets the company bar
  // (Home · Team · Payments · Vendors · Clients · More) with a floating mic and add button.
  const companyIds = useViewerCompanyIds();
  const viewerId = useViewerId();
  const role = useViewerRole(groupId);
  const company = isCompanyMode(segments, groupId, companyIds, role);
  // Household mode: a couple/family/home/pool group wears Personal's bar over its own views.
  const household = useHouseholdMode(segments, groupId) && !company;
  const alt = personal || company || household;
  const theme = useTheme();
  const reduced = useReducedMotion();
  const p = useSharedValue(alt ? 1 : 0);
  const mic = useSharedValue(alt ? 1 : 0);
  const previousPersonal = useRef(alt);
  useEffect(() => {
    // Mount directly into the route's mode; only a real switch earns a tick.
    if (previousPersonal.current === alt) return;
    previousPersonal.current = alt;
    p.value = withTiming(alt ? 1 : 0, {
      duration: reduced ? 120 : 280,
      easing: Easing.linear,
    });
    mic.value = reduced
      ? withTiming(alt ? 1 : 0, { duration: 120 })
      : withSpring(alt ? 1 : 0, { duration: 300, dampingRatio: 0.8 });
  }, [alt, reduced, p, mic]);
  const sharedStyle = useAnimatedStyle(() => ({ opacity: 1 - p.value }));
  const personalStyle = useAnimatedStyle(() => ({ opacity: p.value }));
  const tintStyle = useAnimatedStyle(() => ({ opacity: p.value * 0.35 }));
  const centerStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 1 : 1 - p.value,
    transform: reduced ? [] : [{ scale: 1 - p.value * 0.4 }],
  }));
  const fabStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: reduced ? [] : [{ scale: 0.6 + mic.value * 0.4 }],
  }));
  // Company users get a Company tab where Review was (Review moves to Settings).
  // Derived from the local mirror, so it flips the moment they create/join/leave.
  const companySlot = reviewSlotKey(companyIds) === 'company';
  const sharedActive =
    companyActiveKey(segments, groupId, companyIds) === 'company' ? 'company' : sharedKey;
  const altActive = company
    ? companyBarActiveKey(segments)
    : household
      ? householdBarActiveKey(segments, params)
      : personalActiveKey(segments, params.space);
  const activeKey = alt ? altActive : sharedActive;
  // A screen can also ask the bar to stand down while it is *on* that screen —
  // Review does it while drafts are ticked, so its action bar has the bottom of
  // the phone to itself rather than stacking on top of the navigation with the
  // raised mic over the button somebody is reaching for. See `tabBarSuppress`.
  //
  // Asked about *this* route, never in general. A claim belongs to the screen
  // that made it, and walking away from that screen ends it — otherwise a
  // screen that failed to let go (Review is a tab: it does not unmount, and it
  // does not even re-render while blurred) takes the navigation away from the
  // whole app, with nothing left on screen able to give it back.
  const suppressed = useTabBarSuppressed(segments.join('/'));

  // The Review tab's badge — the same folded count the dashboard hero's inbox
  // circle showed before Activity took its place there (see `(tabs)/index.tsx`).
  // Read here rather than passed down, because the bar is mounted once at the
  // root and outlives whichever screen is on top of it; reusing
  // `foldedCaptureCount`/`captureInboxActionState` rather than a second count
  // is the whole point — a badge that disagreed with the screen it opens would
  // be worse than none.
  const captures = useCaptures();
  const waitingCount = foldedCaptureCount(captures.data ?? []);
  const captureBadge = captureInboxActionState(waitingCount).badge;

  const personalItems = useMemo<PillTabItem[]>(
    () => [
      {
        key: 'home',
        label: t.personalHome.navHome,
        icon: (color, focused) => (
          <Ionicons name={focused ? 'home' : 'home-outline'} size={iconSize.lg} color={color} />
        ),
      },
      {
        key: 'transactions',
        label: t.personal.nav.transactions,
        icon: (color) => <Ionicons name="swap-horizontal" size={iconSize.lg} color={color} />,
      },
      {
        key: 'planning',
        label: t.personalHome.navPlanning,
        icon: (color, focused) => (
          <Ionicons
            name={focused ? 'calendar' : 'calendar-outline'}
            size={iconSize.lg}
            color={color}
          />
        ),
      },
      {
        key: 'reports',
        label: t.personalHome.navReports,
        icon: (color, focused) => (
          <Ionicons
            name={focused ? 'bar-chart' : 'bar-chart-outline'}
            size={iconSize.lg}
            color={color}
          />
        ),
      },
      {
        key: 'accounts',
        label: t.personalHome.navAccounts,
        icon: (color, focused) => (
          <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={iconSize.lg} color={color} />
        ),
      },
    ],
    [t.personal.nav.transactions, t.personalHome],
  );

  const pendingCount = usePendingCount(company ? groupId : null);
  // A suspended company is read-only and a vendor login records nothing: no add button.
  const noAdd =
    useCompanySuspended(company ? (groupId ?? '') : '') || (company && role === 'vendor');
  const companyItems = useMemo<PillTabItem[]>(() => {
    const item = (
      key: string,
      label: string,
      on: keyof typeof Ionicons.glyphMap,
      off: keyof typeof Ionicons.glyphMap,
      badge?: number,
    ): PillTabItem => ({
      key,
      label,
      badge: badge || undefined,
      icon: (color, focused) => (
        <Ionicons name={focused ? on : off} size={iconSize.lg} color={color} />
      ),
    });
    return [
      item('home', t.home, 'home', 'home-outline', pendingCount),
      item('team', t.company.barTeam, 'people-circle', 'people-circle-outline'),
      item('payments', t.company.tabPayments, 'cash', 'cash-outline'),
      item('vendors', t.companyVendors.title, 'storefront', 'storefront-outline'),
      item('clients', t.companyClients.title, 'briefcase', 'briefcase-outline'),
      item(
        'more',
        t.company.barMore,
        'ellipsis-horizontal-circle',
        'ellipsis-horizontal-circle-outline',
      ),
    ];
  }, [pendingCount, t.company, t.companyClients.title, t.companyVendors.title, t.home]);
  // Household: Personal's five tabs, the last one opening the group's members.
  const householdItems = useMemo<PillTabItem[]>(
    () =>
      personalItems.map((item) =>
        item.key === 'accounts'
          ? {
              ...item,
              key: 'me',
              label: t.members,
              icon: (color, focused) => (
                <Ionicons
                  name={focused ? 'people' : 'people-outline'}
                  size={iconSize.lg}
                  color={color}
                />
              ),
            }
          : item,
      ),
    [personalItems, t.members],
  );
  const altItems = company ? companyItems : household ? householdItems : personalItems;

  const sharedItems = useMemo<PillTabItem[]>(
    () => [
      {
        key: 'index',
        label: t.home,
        icon: (color, focused) => (
          <Ionicons name={focused ? 'home' : 'home-outline'} size={iconSize.lg} color={color} />
        ),
      },
      {
        key: 'friends',
        label: t.friends,
        icon: (color, focused) => (
          <Ionicons name={focused ? 'people' : 'people-outline'} size={iconSize.lg} color={color} />
        ),
      },
      companySlot
        ? {
            key: 'company',
            label: t.company.tab,
            icon: (color, focused) => (
              <Ionicons
                name={focused ? 'business' : 'business-outline'}
                size={iconSize.lg}
                color={color}
              />
            ),
          }
        : {
            key: 'captures',
            label: t.review,
            // The visible pill has room for one short word; a screen reader gets
            // the count too, in the same sentence the inbox's own empty/non-empty
            // states already speak (`captures.unassignedBody`) — one wording for
            // "how many are waiting", not a second one invented for the tab.
            accessibilityLabel:
              waitingCount > 0
                ? `${t.review} — ${plural(locale, waitingCount, t.captures.unassignedBody)}`
                : t.review,
            icon: (color, focused) => (
              <Ionicons
                name={focused ? 'file-tray-full' : 'file-tray-full-outline'}
                size={iconSize.lg}
                color={color}
              />
            ),
            badge: captureBadge,
          },
      {
        key: 'me',
        label: t.personal.tab,
        icon: (color, focused) => (
          <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={iconSize.lg} color={color} />
        ),
      },
    ],
    [
      captureBadge,
      companySlot,
      t.company.tab,
      locale,
      t.captures.unassignedBody,
      t.friends,
      t.home,
      t.personal.tab,
      t.review,
      waitingCount,
    ],
  );

  // All bar destinations are tabs now. `navigate` switches to the existing tab
  // route instead of stacking a second copy; only a tap at its root is a no-op.
  const go = useCallback(
    (key: string): void => {
      if (company && groupId) {
        if (key === activeKey && isCompanyBarRoot(segments)) return;
        // First hop pushes, siblings replace, Overview pops: the group root stays mounted.
        const href = companyBarRoute(groupId, key);
        runBarMove(barMove(segments, href), href as never);
        return;
      }
      if (household && groupId) {
        if (key === activeKey && isHouseholdBarRoot(segments, params, key)) return;
        // Home/Transactions/Planning swap params on the mounted root; Reports and Members push
        // from it and replace each other, so the root is never rebuilt and tabs never stack.
        const href = householdBarRoute(groupId, key);
        runBarMove(barMove(segments, href), href as never);
        return;
      }
      if (personal) {
        const route = personalRouteForSelection(activeKey, key, isPersonalRoot(segments, key));
        if (!route) return;
        // Siblings replace each other; the first hop from (tabs) pushes and Home pops
        // back, so the tab navigator is never rebuilt (see personalBarAction).
        const how = personalBarAction(segments, route);
        if (how === 'replace') router.replace(route);
        else if (how === 'dismissTo') router.dismissTo(route);
        else switchTab(route);
        return;
      }
      if (key === 'company') {
        void readLastSpace(viewerId, true).then((last) => {
          const target = companyTabTarget(companyIds, last);
          if (target && !(activeKey === key && isCompanyTabRoot(segments, groupId, companyIds)))
            switchTab(target as never);
        });
        return;
      }
      const route = tabBarRouteForSelection(activeKey, key, isTabRoot(segments, key));
      if (route) switchTab(route);
    },
    [activeKey, company, companyIds, groupId, household, params, personal, segments, viewerId],
  );

  // Nested Personal screens (entry, source, budgets, loans) pop their own stack.
  const nestedPersonal = isNestedPersonal(segments, params.returnTo);

  const personalBack =
    !nestedPersonal &&
    personal &&
    ['home', 'transactions', 'planning', 'reports', 'accounts'].includes(activeKey);
  useEffect(
    () =>
      installTabBack(
        personalBack
          ? () => {
              const back = personalBackRoute(activeKey);
              // From a Personal screen, pop to the mounted (tabs) rather than push a second one.
              if (personalBarAction(segments, back) === 'dismissTo') router.dismissTo(back);
              else switchTab(back);
            }
          : null,
        tabBackDeps,
      ),
    [personalBack, activeKey, segments],
  );

  // Household bar: tabs replace each other, so Back from any tab but Home returns to the
  // household Home (hardware Back here, and every header chevron through the router override).
  const householdBack =
    household && groupId
      ? householdBackRoute(segments, { view: params.view, tab: params.tab, hh: params.hh }, groupId)
      : null;
  useEffect(
    () =>
      installTabBack(
        householdBack === null
          ? null
          : () => runBarMove(barMove(segments, householdBack), householdBack as never),
        tabBackDeps,
      ),
    [householdBack, segments],
  );

  // Company bar: Back on a sub-tab goes to Overview, on Overview to Home.
  const companyBack = company && groupId ? companyBackRoute(segments, groupId) : null;
  useEffect(
    () =>
      installTabBack(
        companyBack === null
          ? null
          : () => {
              // dismissTo pops to Home, so the Overview slides out to the right like a Back.
              if (companyBack === '/') router.dismissTo('/');
              else runBarMove(barMove(segments, companyBack), companyBack as never);
            },
        tabBackDeps,
      ),
    [companyBack, segments],
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
    // In Personal mode the mic adds a private expense: "only me" is preselected.
    if (personal) router.push({ pathname: '/voice', params: { scope: 'personal' } });
    else router.push(groupId ? { pathname: '/voice', params: { group: groupId } } : '/voice');
  }, [groupId, personal]);

  // The finger has landed: open the voice screen *now*. The mic on that screen
  // starts itself as it mounts, so this is the earliest the recogniser can
  // possibly be live — earlier than today's tap, which waits for the lift.
  // Hold on the spot (a pill over this screen) when the mic is ready to listen
  // and nothing has to be asked first; otherwise open the voice screen, where
  // the consent and permission flows live.
  const { enabled: agentServerOn, ready: statusReady } = useVoiceAgentStatus();
  const voiceConsent = useVoiceConsent(viewerId);
  useEffect(() => {
    void refreshHoldMic();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshHoldMic();
    });
    return () => sub.remove();
  }, []);
  // `down`: finger on the mic over this screen; `send`: lifted, being finished.
  const [holdMode, setHoldMode] = useState<'off' | 'down' | 'send'>('off');
  // This hold is the in-place pill, not the voice screen.
  const inPlace = useRef(false);

  const holdStart = useCallback((): void => {
    cancelled.current = false;
    buzz(15);
    const { recognition, micGranted } = holdMicState();
    inPlace.current =
      holdPlan({
        recognition,
        micGranted,
        statusReady,
        consentReady: voiceConsent.ready,
        agentServerOn,
        consent: voiceConsent.state,
      }) === 'overlay';
    pushToTalk.begin();
    if (inPlace.current) {
      setHoldMode('down');
      return;
    }
    setHolding(true);
    openVoice();
  }, [agentServerOn, openVoice, statusReady, voiceConsent.ready, voiceConsent.state]);

  // The finger has lifted. A press too brief to have carried any speech is a
  // plain tap and opens the voice screen, as it always has.
  const holdEnd = useCallback((): void => {
    setHolding(false);
    if (cancelled.current) return;
    const result = pushToTalk.release();
    if (inPlace.current) {
      if (result === 'send') {
        buzz(15);
        setHoldMode('send');
      } else {
        setHoldMode('off');
        openVoice();
      }
      return;
    }
    if (result === 'send') buzz(15);
  }, [openVoice]);

  // Sliding off the button abandons the whole thing, the way it does on a voice
  // note. Which way is "off" follows the writing direction: the gesture reads as
  // sweeping the message away, and in Arabic that sweep goes the other way.
  const holdMove = useCallback(({ dx }: { dx: number; dy: number }): void => {
    if (cancelled.current) return;
    const away = isRtl() ? dx : -dx;
    if (away < CANCEL_DISTANCE) return;
    cancelled.current = true;
    setHolding(false);
    setHoldMode('off');
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
      accessibilityLabel: personal ? t.personal.nav.voiceFab : t.voice.speakExpense,
      accessibilityHint: t.voice.micHint,
      onPress: openVoice,
      onPressIn: holdStart,
      onPressOut: holdEnd,
      onHoldMove: holdMove,
      icon: (color: string) => <Ionicons name="mic" size={iconSize.lg} color={color} />,
    }),
    [
      holdEnd,
      holdMove,
      holdStart,
      openVoice,
      personal,
      t.personal.nav.voiceFab,
      t.voice.micHint,
      t.voice.speakExpense,
    ],
  );

  // Company mode's round add button, in the place Personal moves the mic to.
  const fabOverride = useFabOverride();
  const add = useMemo<PillTabAction>(
    () => ({
      accessibilityLabel: fabOverride?.label ?? t.company.addEntry,
      onPress: () => {
        if (fabOverride) fabOverride.run();
        else if (groupId) router.push(`/group/${groupId}/company-entry`);
      },
      icon: (color: string) => <Ionicons name="add" size={iconSize.xl} color={color} />,
    }),
    [groupId, t.company.addEntry, fabOverride],
  );

  // Hidden, unless a hold is running — see `holding` above. A hold wins over a
  // screen's request too: the mic is the thing under the finger at that moment,
  // and taking it away mid-sentence would cancel what somebody is saying.
  const showBar = !((hidden || suppressed) && !holding);
  // Only the company bar floats buttons (Personal and household have none), so lists leave room for it alone.
  const fab =
    alt &&
    showBar &&
    showFab(segments, company) &&
    fabDrawn({ personal, company, noAdd, segments });
  useEffect(() => {
    setTabBarFab(fab);
    return () => setTabBarFab(false);
  }, [fab]);
  if (!showBar) return null;

  return (
    <>
      {/* The in-app update bar rides on the navigation: there wherever the bar
          is, gone wherever it is not. */}
      <UpdateBar />
      <HoldVoiceHost
        mode={holdMode}
        groupId={groupId}
        personal={personal}
        onFinished={() => setHoldMode('off')}
      />
      {/* Both frames stay put: fading destinations never moves screen content. */}
      {[false, true].map((mode) => (
        <Animated.View
          key={String(mode)}
          pointerEvents={alt === mode ? 'box-none' : 'none'}
          accessibilityElementsHidden={alt !== mode}
          importantForAccessibility={alt === mode ? 'auto' : 'no-hide-descendants'}
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: BAR_HEIGHT + insets.bottom + 16,
            },
            mode ? personalStyle : sharedStyle,
          ]}
        >
          <PillTabBar
            items={mode ? altItems : sharedItems}
            activeKey={mode ? altActive : sharedActive}
            onSelect={go}
            animated={!reduced}
            reserveCenterSpace
            centerAction={mode ? undefined : voice}
            renderItem={(content, index) => (
              <ModeItem
                p={p}
                index={index}
                personal={mode}
                reduced={reduced}
                focused={
                  (mode ? altItems : sharedItems)[index]?.key === (mode ? altActive : sharedActive)
                }
              >
                {content}
              </ModeItem>
            )}
            renderCenterAction={(content) => (
              <Animated.View style={centerStyle}>{content}</Animated.View>
            )}
            backgroundOverlay={
              mode ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
                    { backgroundColor: theme.color.brandSoft },
                    tintStyle,
                  ]}
                />
              ) : undefined
            }
          />
        </Animated.View>
      ))}
      {company && showFab(segments, company) ? (
        // Same button and the same hold-to-talk as the raised mic, floated
        // bottom-right (bottom-left in RTL) above the Personal bar.
        <Animated.View
          pointerEvents={alt ? 'box-none' : 'none'}
          accessibilityElementsHidden={!alt}
          importantForAccessibility={alt ? 'auto' : 'no-hide-descendants'}
          style={[
            {
              position: 'absolute',
              bottom: insets.bottom + BAR_HEIGHT + FAB_GAP,
              ...(isRtl() ? { left: 16 } : { right: 16 }),
              transformOrigin: isRtl() ? 'bottom left' : 'bottom right',
            },
            fabStyle,
          ]}
        >
          {company ? (
            noAdd ? null : (
              // Company: speak an expense or "add employee Ravi" beside the add button.
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <CenterButton action={voice} />
                <CenterButton action={add} />
              </View>
            )
          ) : null}
        </Animated.View>
      ) : null}
    </>
  );
}
