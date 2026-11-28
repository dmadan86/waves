import { DEMO_GROUP_ID } from '@/demo/ids';
import { headlineGroupCounts } from '@/lib/homeDashboard';
import { collectPay } from '@/lib/homeCollectPay';
import { useQueryClient } from '@tanstack/react-query';
import { withScenic } from '@/components/ScenicScope';
import { adGateQuery } from '@/lib/adGateQuery';
import { useEntitlement } from '@/lib/useEntitlement';
import { useFlagEnabled } from '@/lib/flags';
import { AdSlot } from '@/components/AdSlot';
import { useAdPlan } from '@/lib/useAdPlan';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { InteractionManager, RefreshControl, View } from 'react-native';

import { fallbackCurrency, type GuestGate } from '@waves/core';
import { Button, Popup, Row, Screen, Text, useTheme } from '@waves/ui';

import {
  useGroups,
  useHomeSummary,
  useNewestActivityFromOthers,
  usePeopleBalances,
} from '@/data/hooks';
import { useSync } from '@/sync';
import { useHouseholdBillReminders, useRecurringCatchUp } from '@/data/groupRecurring';
import { hasUnseenActivity, useActivitySeenAt } from '@/lib/activitySeen';
import { useGroupUnread } from '@/lib/useGroupUnread';
import { orderByActivity } from '@/lib/groupActivityOrder';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { trialDaysLeft } from '@/lib/proTrial';
import { useProTrial } from '@/lib/useProTrial';
import { useAuth } from '@/lib/auth';
import { useGuestGuard } from '@/lib/guestGuard';
import { router, switchTab } from '@/lib/navigation';
import { useNavigation } from 'expo-router';
import { usePromptSlot } from '@/lib/promptQueue';
import { TourTarget, useTour } from '@/lib/tour';
import { tourMayStart, useOverlayBusy } from '@/lib/firstRun';
import { useViewerCompanyIds } from '@/lib/useCompanyTab';
import { groupsOutsideCompanies } from '@/lib/spaces';
import { useColdStartSpace } from '@/lib/useSpaces';
import { ImportProgressBanner } from '@/components/ImportProgressBanner';
import { LinkRequestsCard } from '@/components/LinkRequestsCard';
import { SkeletonList } from '@/components/Skeletons';
import { useImportedGroupId } from '@/lib/importProgress';
import { useHomeHero } from '@/lib/useHomeHero';
import { useReferralsLive } from '@/lib/useReferralsLive';
import { THEME_HIDDEN } from '@/lib/theme';
import { useDefaultCurrency } from '@/lib/currency';
import { QuickAddSheet, useQuickAddActions } from '@/components/QuickAddSheet';
import { QuickExpenseSheet } from '@/components/QuickExpenseSheet';
import { HomeBalanceCard } from '@/components/home/ScenicBalanceCard';
import { SpaceSwitchSheet } from '@/components/SpaceSwitcher';
import { COMPANIES_ENABLED } from '@/lib/companiesEnabled';
import { PersonAvatar } from '@/components/PersonAvatar';
import { TabIconButton } from '@/components/home/TabHeader';
import { HomeHeroBackground } from '@/components/home/HomeHeroBackground';
import { NewGroupMenu, type MenuAnchor } from '@/components/home/NewGroupMenu';
import { HomeQuickActions } from '@/components/home/HomeQuickActions';
import { NeedsYouCard } from '@/components/home/HomeToday';
import { CollectPayTiles } from '@/components/home/CollectPayTiles';
import { SpacesGrid } from '@/components/home/HomeSpaces';
import { useHomeSpaceFigures } from '@/data/homeSpaces';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { personalHomeIdentity } from '@/data/personalHomeIdentity';
import { useProfileForDisplay } from '@/lib/profileCache';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { DateReminderCard } from '@/components/dates/DateReminderCard';
import { TipSheet } from '@/components/home/TipSheet';
import { ScenicScreen } from '@/components/hero/ScenicScreen';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { useVoiceNewCount } from '@/lib/voiceSpaceStore';
import { BackupReminder } from '@/components/BackupReminder';
import { RestorePrompt } from '@/components/RestorePrompt';
import { preloadBalanceHidden, useBalanceHidden } from '@/lib/balanceHidden';
import { HomeSnapshotView } from '@/components/home/HomeSnapshotView';
import { serialiseSnapshot, type HomeSnapshot, type SnapRow } from '@/lib/homeSnapshot';
import { clearHomeSnapshot, saveHomeSnapshot, useHomeSnapshot } from '@/lib/homeSnapshotStore';
import { usePullRefresh } from '@/lib/pullRefresh';
import { fill } from '@/i18n';

/** Dashboard route with duplicate-safe jumps to stable primary destinations. */
// Read the eye preference at launch, in parallel with the mirror, not on first mount.
preloadBalanceHidden();

function HomeScreen() {
  const theme = useTheme();
  const pull = usePullRefresh();
  const { t, locale } = useStrings();
  const { session, profile, isGuest } = useAuth();
  // Name and currency survive an offline cold start (display only).
  const displayProfile = useProfileForDisplay();
  /**
   * Who to compute balances as — the *session's* user id, not the profile's.
   *
   * They are the same id by construction (`loadProfile` selects the profile row
   * whose id is the session user's), but they do not arrive at the same time.
   * The session is restored from secure storage at launch, with no network. The
   * profile is a fetch, retried, and on a phone on mobile data it lands a good
   * second later — which is the "Hi, You" in the screenshot before it becomes
   * "Hi, Madan D".
   *
   * Reading the viewer from the profile therefore made a network round trip a
   * prerequisite for showing a number that was already on the device. Reading it
   * from the session makes the balance correct on the first frame, offline
   * included, which is what ADR-005 asks of every other surface in the app.
   *
   * The greeting and the avatar still wait for the profile — those genuinely are
   * profile fields, and a name that appears a beat late is not a wrong name.
   */
  const viewerId = session?.user?.id ?? null;
  const queryClient = useQueryClient();
  const { isPaid, loading: entitlementLoading } = useEntitlement();
  const adsEnabled = useFlagEnabled('ads_native');
  useEffect(() => {
    if (!viewerId || isGuest || isPaid || entitlementLoading || !adsEnabled) return;
    void queryClient.prefetchQuery(adGateQuery(viewerId));
  }, [viewerId, isGuest, isPaid, entitlementLoading, adsEnabled, queryClient]);
  // The header avatar sits in the private bucket, so its path has to be signed
  // before an Image can show it — the same resolution the profile screen does.
  // Without this the dashboard falls back to initials while settings shows the
  // photo, which reads as the picture "not loading" on the home screen.

  const groups = useGroups();
  const totalGroupCount = groups.data?.length ?? 0;
  const summary = useHomeSummary(viewerId);
  const { catchUp } = useSync();
  const guard = useGuestGuard();
  const tour = useTour();

  // A press-and-hold on any add icon raises the same quick-add sheet — type,
  // scan, or speak an expense — the phone-home-screen quick-actions gesture.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false);
  const quickAddActions = useQuickAddActions();

  const defaultCurrency = useDefaultCurrency();
  // The eye toggle: hide the money on a shared screen, remembered across opens.
  const { hidden: balanceHidden, ready: balanceReady, toggle: toggleBalance } = useBalanceHidden();
  const displayName = personalHomeIdentity(
    displayProfile,
    [],
    [],
    defaultCurrency,
    t.account.you,
  ).name;
  const firstName = displayName.trim().split(/\s+/)[0];
  const h = t.personalHome;
  // First word only, so a long name never truncates to "Hi, Madan Dei…".
  const companyIds = useViewerCompanyIds();

  /**
   * Most recently used first, then pins in front of that.
   *
   * The order groups arrive in is `created_at` — the day you were *added* to
   * one, which says nothing about whether you use it. With only
   * GROUPS_PREVIEW slots that meant a trip that ended in March could hold a
   * row for a year while the flat you settle up in weekly fell off the
   * bottom. Ordering by when each ledger last
   * moved lets a dormant group sink on its own and brings it straight back
   * the moment somebody spends — without hiding anything, because a settled
   * group is not a finished one.
   *
   * The order is settled *before* the slice: recency is precisely an argument
   * about which groups deserve the limited slots, so it has to be settled while
   * there are still rows to lose.
   */
  const list = useMemo(
    () =>
      orderByActivity(groupsOutsideCompanies(groups.data ?? []), (group) =>
        summary.lastActivityFor(group.id),
      ),
    [groups.data, summary],
  );
  // Two states, not one, because they deserve different answers.
  //
  // `hydrating` is "there is nothing to paint": the mirror has not been read off
  // disk yet. It lasts milliseconds and a skeleton is exactly right for it.
  //
  // `settling` is "here it is, but this session's first sync has not landed yet",
  // so what is on screen came from the local snapshot and could still move. That
  // used to hold the skeleton up too — the whole screen shimmering over figures
  // the app already had, for as long as the network took. What somebody actually
  // wants there is their balance and their groups, marked as not-yet-final: the
  // numbers are shown, under a still mask, and settle in place when the sync
  // lands. Bounded either way — `pendingFirstSync` clears on the first success
  // *or* on a can't-sync status (offline, metered, error), where the local
  // snapshot is the best there is.
  // Three ways of not knowing, and the third is the one that bit. The mirror may
  // not have hydrated; the first sync may not have landed; and — separately from
  // both — the *profile* may not have arrived, in which case there is no "you"
  // for a balance to be about. That last state used to paint anyway, from the
  // first ghost in each group, and a whole ledger read from somebody else's side
  // is not a rough number: it is the opposite sign, in the opposite colour,
  // under the opposite word. `data/types.isViewer` stops it being computed;
  // this stops the empty result that remains being shown as an answer.
  const hydrating = groups.isLoading || summary.isLoading || summary.viewerUnknown;
  // And a third case that is neither: the mirror answered, but with nothing in
  // it, while the first sync is still out. That is "we do not know yet", not
  // "you have no groups" — and on a fresh install or a new sign-in the two look
  // identical from here. Painting the empty state over it would tell somebody
  // with eleven groups that they have none, for as long as the network took.
  const unknownYet = !hydrating && list.length === 0 && summary.pendingFirstSync;
  // The placeholder covers both: nothing read yet, or nothing read *and* nothing
  // confirmed. Everything else paints.
  const showSkeleton = hydrating || unknownYet;
  // Last launch's frame, drawn while the mirror and first sync are still coming
  // in; null for a new account, so those see the skeleton as before.
  const stored = useHomeSnapshot(viewerId);
  const showStale = showSkeleton && stored !== null;
  const coldStartHold = useColdStartSpace(!showSkeleton, companyIds);
  const settling = !showSkeleton && summary.pendingFirstSync;

  // A ledger import running in the background (see `@/lib/importProgress`): its
  // banner sits above the group list, and when it lands the just-added group
  // slides into the list. This reads *only* the landed group id (a primitive),
  // so the dashboard re-renders on the success transition alone — never on the
  // running/waiting churn, which would otherwise re-render this heavy screen and
  // make the app crawl while an import ran. The banner owns the running state.
  const justAddedId = useImportedGroupId();

  // First time on Home, once the "seen" flag has been read *and the data has
  // loaded*, run the tour. Waiting on the data matters: the coach-marks anchor
  // on the hero and the add buttons, and starting over skeletons spotlights the
  // wrong rectangle until the real content reflows in under the hole. That
  // includes the balance skeleton — `balanceReady` gates the hero's number, so
  // starting before it settles would anchor the hero mark on the placeholder
  // and then shift when the real amount paints.
  //
  // The ref makes this fire exactly once — without it the effect would re-run
  // each time the tour advances (its value changes) and snap back to step one.
  // It remembers itself when finished; "Take the tour again" in the menu replays.
  // Repeating group expenses that came due while the app was closed.
  useRecurringCatchUp();
  useHouseholdBillReminders();

  // The tour holds the top of the prompt queue for the whole of a first run —
  // from the moment we know it is owed (ready, not seen), through the wait for
  // data and the tour itself, until it finishes and marks itself seen. While it
  // holds the slot the daily tip stands down; see `TipSheet`.
  const tourSlot = usePromptSlot({
    id: 'tour',
    priority: 100,
    // The tour follows full-screen onboarding, but still spends the single
    // launch prompt allowance before every other launch-time ask.
    allowAfterPrompt: true,
    active: tour.active || (tour.ready && !tour.seen),
  });

  const tourStarted = useRef(false);
  // The tour waits for the intro, any dialog/sheet/ad/permission prompt, this
  // screen being focused, and entrance animations to finish (`lib/firstRun`).
  const overlayIsBusy = useOverlayBusy();
  const navigation = useNavigation();
  const [focused, setFocused] = useState(() => navigation.isFocused());
  useEffect(() => {
    const off = [
      navigation.addListener('focus', () => setFocused(true)),
      navigation.addListener('blur', () => setFocused(false)),
    ];
    return () => off.forEach((fn) => fn());
  }, [navigation]);
  const [interactionsDone, setInteractionsDone] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setInteractionsDone(true));
    return () => handle.cancel();
  }, []);
  useEffect(() => {
    if (tourStarted.current) return;
    if (
      tourMayStart({
        tourReady: tour.ready,
        tourSeen: tour.seen,
        // Live data only: the snapshot is never what the tour spotlights.
        dataReady: !showSkeleton && balanceReady,
        introVisible: false, // the intro is one of the `busy` reasons
        promptGranted: tourSlot,
        busy: overlayIsBusy,
        focused,
        interactionsDone,
      })
    ) {
      tourStarted.current = true;
      tour.start();
    }
  }, [
    tour.ready,
    tour.seen,
    tour,
    showSkeleton,
    balanceReady,
    overlayIsBusy,
    focused,
    interactionsDone,
    tourSlot,
  ]);

  // The header overflow menu (the three-dot dropdown): the settings and the
  // less-used destinations, surfaced from the dashboard rather than only from
  // the profile tab.
  const [menuOpen, setMenuOpen] = useState(false);
  // Personal bills Needs you is showing, so Coming up leaves them out.
  // Same test the Upgrade screen uses for `plansLive`: the paywall flag is on
  // and this build can buy. A guest signs up first, so the row waits for that.
  const canUpgrade = useReferralsLive() && !isGuest;
  const proTrial = useProTrial();
  const [switchOpen, setSwitchOpen] = useState(false);
  const menuItems: OverflowMenuItem[] = useMemo(
    () => [
      // Opens the Switch space sheet; OverflowMenu closes first, then runs this.
      // Only companies make a second space, so no row while they are off.
      ...(COMPANIES_ENABLED
        ? [
            {
              icon: 'swap-horizontal-outline',
              label: t.spaces.pillLabel,
              onPress: () => setSwitchOpen(true),
              section: 'space',
            } as OverflowMenuItem,
          ]
        : []),
      // The `section` keys are internal grouping only (not user-visible): they
      // cluster the rows into account / data / app / settings, and
      // OverflowMenu draws a divider wherever two adjacent rows fall in
      // different sections.
      //
      // No "actions" rows: scan to join, scan bill, bank messages and settle up
      // all have homes of their own (Friends' add sheet, the + Expense hold,
      // Review, a group's settle), so the menu is settings and destinations only.
      // Upgrade leads the menu while plans can be bought, so the paywall is one
      // tap from the dashboard rather than three under the profile.
      ...(canUpgrade
        ? [
            {
              icon: 'rocket-outline' as const,
              label: proTrial ? plural(locale, trialDaysLeft(proTrial), t.upgradeTrial) : t.upgrade,
              route: '/paywall' as const,
              section: 'account' as const,
            },
          ]
        : []),
      { icon: 'language-outline', label: t.language, route: '/settings/language', section: 'app' },
      { icon: 'image-outline', label: t.heroScene.title, route: '/settings/scene', section: 'app' },
      // Appearance is hidden while THEME_HIDDEN stands; the screen behind it is
      // still routable, just not offered.
      ...(THEME_HIDDEN
        ? []
        : [
            {
              icon: 'contrast-outline' as const,
              label: t.account.themeRow,
              route: '/settings/theme' as const,
              section: 'app' as const,
            },
          ]),
      {
        icon: 'settings-outline',
        label: t.account.faceSettings,
        route: '/profile',
        section: 'settings',
      },
      {
        icon: 'sparkles-outline',
        label: t.tour.replay,
        onPress: () => tour.start(),
        section: 'settings',
      },
    ],
    [t, locale, tour, canUpgrade, proTrial],
  );

  // A guest tapping "new group" past their limit is sent to sign up rather than
  // into a form the server would refuse (ADR-006 addendum). A full user's guard
  // waves this through.
  const openNewGroup = (type?: string): void => {
    if (guard.blockAddGroup()) return;
    router.push(type ? `/new-group?type=${type}` : '/new-group');
  };
  // Every "new group" door on Home opens this menu: create, scan, or join.
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const homeAds = useAdPlan('home_groups', {
    rowCount: totalGroupCount,
    surfaceState: { sheetOpen: menuOpen || newGroupOpen },
  });
  const homeAdSlot = homeAds.plan.slots[0];
  const [newGroupAnchor, setNewGroupAnchor] = useState<MenuAnchor | null>(null);
  const openNewGroupMenu = (anchor: MenuAnchor | null): void => {
    setNewGroupAnchor(anchor);
    setNewGroupOpen(true);
  };

  /**
   * The headline is one currency, because there is no such thing as a total
   * across several (ADR-004). The rest are counted underneath rather than added
   * in, which is what the profile screen already does with settled totals.
   *
   * With no groups there is nothing to be owed in, so the zero is shown in the
   * same currency a new group would start in on this phone — otherwise the
   * empty state reads ₹0 and the first group then counts in dollars.
   */
  const liveHeadline = summary.totals[0] ?? {
    currency: defaultCurrency,
    net: 0n,
    owed: 0n,
    owing: 0n,
  };
  const headline =
    showStale && stored
      ? {
          currency: stored.headline.currency,
          net: BigInt(stored.headline.net),
          owed: BigInt(stored.headline.owed),
          owing: BigInt(stored.headline.owing),
        }
      : liveHeadline;

  // The hero's tiles come from the same per-person rows as "Needs you".
  const peopleRows = usePeopleBalances(viewerId).data;
  const tiles = useMemo(
    () => collectPay(peopleRows ?? [], headline.currency),
    [peopleRows, headline.currency],
  );

  // Which photograph the hero wears: the clock's (and region's), or the one
  // picked on the Background screen.
  const hero = useHomeHero();
  // The bell's red dot: somebody else has done something since Activity was
  // last opened. Your own expenses are not news.
  const newestFromOthers = useNewestActivityFromOthers(viewerId);
  const activitySeenAt = useActivitySeenAt();
  const unseenActivity = hasUnseenActivity(newestFromOthers, activitySeenAt);
  // The per-group version of the same dot: a group someone else has touched
  // since the reader last opened it. Over the whole list, not just the
  // preview, so "All groups" can say when the news is in a row cut off below.
  const groupIds = useMemo(() => list.map((group) => group.id), [list]);
  const unreadGroups = useGroupUnread(groupIds);
  const voiceNewCount = useVoiceNewCount();
  const unreadSet = useMemo(
    () => new Set(groupIds.filter((id) => unreadGroups.has(id) || voiceNewCount(id) > 0)),
    [groupIds, unreadGroups, voiceNewCount],
  );

  // Settle up opens its own screen (`/settle-up`), which works out the groups.
  // How many groups each side of the balance card comes from — in the
  // headline's currency, the one those sides are totalled in. The demo group is
  // in no total, so it is no count either (and offers no Remind or Settle up).
  const real = list.filter((g) => g.id !== DEMO_GROUP_ID);
  const counts = headlineGroupCounts(
    list,
    headline.currency,
    fallbackCurrency(),
    summary.balanceFor,
    DEMO_GROUP_ID,
  );
  const liveOwedGroups = counts.owed;
  const liveOwingGroups = counts.owing;
  const owedGroups = showStale && stored ? stored.headline.owedGroups : liveOwedGroups;
  const owingGroups = showStale && stored ? stored.headline.owingGroups : liveOwingGroups;
  // Any currency, not only the headline one: the action is about people, not a total.
  const canRemind =
    showStale && stored
      ? stored.headline.owedGroups > 0
      : real.some((g) => summary.balanceFor(g.id) > 0n);
  const canSettle =
    showStale && stored
      ? stored.headline.owingGroups > 0
      : real.some((g) => summary.balanceFor(g.id) < 0n);

  // Home's feed: the personal ledger (for Personal's tile and the bills that
  // need paying), the pooled groups' figures, and whether there is anything yet.
  const ledger = usePersonalLedger();
  const personalCurrency = personalHomeIdentity(
    displayProfile,
    ledger.txns,
    ledger.budgets,
    defaultCurrency,
    t.account.you,
  ).currency;
  const [today] = useState(() => todayIso());
  const figures = useHomeSpaceFigures();
  const { hidden: personalHidden, ready: personalReady } = usePersonalAmountsHidden();
  const amountsHidden = balanceHidden || !balanceReady;
  const todayLedger = {
    txns: ledger.txns,
    recurrings: ledger.recurrings,
    budgets: ledger.budgets,
    currency: personalCurrency,
    today,
  };
  const newUser =
    list.length === 0 &&
    ledger.txns.length === 0 &&
    ledger.recurrings.length === 0 &&
    ledger.budgets.length === 0;

  // Save the frame once it is live and settled, quietly, and only if it changed.
  const parts = useRef<{
    needs: SnapRow[];
    needsTotal: number;
    personal: SnapRow | null;
    groups: SnapRow[];
  }>({ needs: [], needsTotal: 0, personal: null, groups: [] });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef('');
  const frame = {
    viewerId,
    live: !showSkeleton && !summary.pendingFirstSync,
    newUser,
    headline: {
      currency: liveHeadline.currency,
      net: String(liveHeadline.net),
      owed: String(liveHeadline.owed),
      owing: String(liveHeadline.owing),
      owedGroups: liveOwedGroups,
      owingGroups: liveOwingGroups,
    },
  };
  const frameRef = useRef(frame);
  useEffect(() => {
    frameRef.current = frame;
  });
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const f = frameRef.current;
      if (!f.viewerId || !f.live) return;
      if (f.newUser) {
        if (lastSaved.current !== 'new') void clearHomeSnapshot(f.viewerId).catch(() => {});
        lastSaved.current = 'new';
        return;
      }
      const personal = parts.current.personal;
      if (!personal) return;
      const snapshot: HomeSnapshot = {
        v: 1,
        viewerId: f.viewerId,
        headline: f.headline,
        comingUp: [], // kept in the stored shape; Home no longer draws Coming up
        ...parts.current,
        personal,
      };
      const text = serialiseSnapshot(snapshot);
      if (text === lastSaved.current) return;
      lastSaved.current = text;
      void saveHomeSnapshot(snapshot);
    }, 1200);
  }, []);
  const headlineKey = JSON.stringify(frame.headline);
  useEffect(() => {
    scheduleSave();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [scheduleSave, headlineKey, frame.live, frame.newUser, viewerId]);

  // A sheet that reads groups must not open over a still-empty mirror: a tap
  // during the snapshot frame waits for live data, then runs once.
  const pendingTap = useRef<(() => void) | null>(null);
  const whenLive = (fn: () => void) => () => {
    if (showSkeleton) pendingTap.current = fn;
    else fn();
  };
  useEffect(() => {
    if (showSkeleton || !pendingTap.current) return;
    const fn = pendingTap.current;
    pendingTap.current = null;
    fn();
  }, [showSkeleton]);

  if (coldStartHold) return <Screen edges={[]}>{null}</Screen>;

  return (
    <Screen edges={[]}>
      <ScenicScreen
        background={(g) => <HomeHeroBackground hero={hero} {...g} />}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={theme.color.brand}
          />
        }
        header={(ink, solid) => (
          <Row style={{ flex: 1, alignItems: 'center', gap: theme.spacing.sm }}>
            <PersonAvatar
              name={displayName}
              avatarUrl={profile?.avatar_url}
              size={44}
              accessibilityLabel={t.profile}
              onPress={() => router.navigate('/profile')}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={{
                  color: ink,
                  fontSize: 18,
                  lineHeight: 23,
                  fontWeight: '700',
                  ...(solid
                    ? null
                    : {
                        textShadowColor: 'rgba(0,0,0,0.35)',
                        textShadowOffset: { width: 0, height: 1 },
                        textShadowRadius: 4,
                      }),
                }}
              >
                {fill(h.hi, { name: firstName ?? '' })}
              </Text>
            </View>
            <TabIconButton
              icon="notifications-outline"
              label={unseenActivity ? `${t.activity}, ${t.tagNew}` : t.activity}
              onPress={() => router.navigate('/activity')}
              dot={unseenActivity}
            />
            <TabIconButton
              icon="ellipsis-vertical"
              label={t.account.faceSettings}
              onPress={() => setMenuOpen(true)}
            />
          </Row>
        )}
        card={(sceneRef) => (
          <TourTarget id="hero">
            <HomeBalanceCard
              net={headline.net}
              owed={headline.owed}
              owing={headline.owing}
              owedGroups={owedGroups}
              owingGroups={owingGroups}
              hideFigure
              label={catchUp ? undefined : t.homeDash.withPeople}
              sides={
                <CollectPayTiles
                  data={tiles}
                  currency={headline.currency}
                  locale={locale}
                  hidden={balanceHidden || !balanceReady}
                  loading={showSkeleton || !balanceReady || showStale || !!catchUp || !peopleRows}
                />
              }
              currency={headline.currency}
              locale={locale}
              hidden={balanceHidden || !balanceReady}
              onToggleHide={toggleBalance}
              settling={settling || showStale}
              catchUp={catchUp}
              loading={(showSkeleton && !showStale) || !balanceReady}
              blurTarget={sceneRef}
              footer={
                <HomeQuickActions
                  // The quick sheet, not the capture screen: most spends know
                  // where they belong and need an amount and a place. The long
                  // press raises type / scan / speak, unchanged.
                  onAddExpense={whenLive(() => setQuickExpenseOpen(true))}
                  onAddExpenseLong={whenLive(() => setQuickAddOpen(true))}
                  onSettleUp={() => router.push('/settle-up')}
                  onReview={() => router.navigate('/captures')}
                  onScan={() => router.push(`/capture?scan=${Date.now()}`)}
                  onRemind={() => switchTab('/(tabs)/friends')}
                  // Remind only makes sense when somebody owes you; otherwise
                  // the slot offers joining a group, which a new person can use.
                  onJoin={canRemind ? undefined : () => router.push('/scan?mode=paste')}
                  canSettle={canSettle}
                  radius={theme.radius.xl}
                />
              }
            />
          </TourTarget>
        )}
      >
        {/* A background import's progress lands here, just above the groups —
              the person tapped Import, came home, and watches it fill. */}
        <ImportProgressBanner />

        {/* "Madan says you are Renny in Goa trip": somebody has named this
              person as a placeholder in their group, and only they can say
              yes. Drawn only while something is waiting. */}
        <LinkRequestsCard enabled={session !== null && !isGuest} />

        {/* A friendly "From Waves" reminder for a date coming up: inline,
              one at a time, never a pop-up. Drawn only while one is due. */}
        <DateReminderCard />

        {showStale && stored ? (
          <HomeSnapshotView
            snapshot={stored}
            hidden={amountsHidden}
            personalHidden={personalHidden || !personalReady}
            locale={locale}
          />
        ) : showSkeleton ? (
          <View style={{ paddingTop: theme.spacing.sm }}>
            <SkeletonList rows={3} />
          </View>
        ) : (
          <View style={{ paddingTop: theme.spacing.sm, gap: theme.spacing.lg }}>
            {/* A new person has nothing to act on yet: the three starter tiles
                  below stand in for the whole feed. */}
            {newUser ? null : (
              <NeedsYouCard
                ledger={todayLedger}
                viewerId={viewerId}
                hidden={amountsHidden}
                onSnapshot={(rows, total) => {
                  parts.current.needs = rows;
                  parts.current.needsTotal = total;
                  scheduleSave();
                }}
              />
            )}
            <SpacesGrid
              groups={list}
              summary={summary}
              viewerId={viewerId}
              pool={figures.pool}
              ledger={todayLedger}
              hidden={amountsHidden}
              personalHidden={personalHidden}
              locale={locale}
              newUser={newUser}
              unreadGroups={unreadSet}
              onNewSpace={openNewGroupMenu}
              onNewGroup={openNewGroup}
              onSnapshot={(personal, groupRows) => {
                parts.current.personal = personal;
                parts.current.groups = groupRows;
                scheduleSave();
              }}
            />
            {/* One native card after the grid for a long roster (>= 10 groups),
                  never while a fresh import is sliding in. */}
            {homeAdSlot !== undefined && justAddedId == null ? (
              <AdSlot
                handle={homeAds}
                format="native"
                slot={homeAdSlot}
                rowGap={theme.spacing.sm}
              />
            ) : null}
          </View>
        )}
      </ScenicScreen>
      <OverflowMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        header={{
          name: displayName,
          avatar: <PersonAvatar name={displayName} avatarUrl={profile?.avatar_url} size={40} />,
          route: '/settings/account',
        }}
      />
      <SpaceSwitchSheet current="personal" open={switchOpen} onClose={() => setSwitchOpen(false)} />
      <NewGroupMenu
        open={newGroupOpen}
        anchor={newGroupAnchor}
        onClose={() => setNewGroupOpen(false)}
        onCreate={() => openNewGroup()}
      />

      {/* Signed in on a phone that holds no personal ledger — a new handset, a
          reinstall, a sign-out and back in — and asked once whether to bring the
          Drive backup back. It decides for itself whether it applies; see
          `lib/backup/restorePrompt`. Outranks the guest and tip prompts. */}
      <RestorePrompt />

      {/* Once a day, when the personal ledger has something a backup would
          save and none has landed in the last day: back it up to Drive. See
          `lib/backup/reminder`. */}
      <BackupReminder />

      {/* Guests are nudged to secure their account as a popup — once a day,
          dismissible, held back while the tour is up. */}
      {isGuest ? (
        <GuestPopup gate={guard.gate} t={t} onAction={() => router.push('/settings/account')} />
      ) : null}

      {/* The daily tip, surfaced as a sheet on the first Home open of the day. */}
      <TipSheet />

      <QuickAddSheet
        visible={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        actions={quickAddActions}
      />

      <QuickExpenseSheet visible={quickExpenseOpen} onClose={() => setQuickExpenseOpen(false)} />
    </Screen>
  );
}

/** The AsyncStorage key holding the day the guest last closed the prompt. */
const GUEST_PROMPT_DISMISS_KEY = 'guestPrompt:dismissedOn';

/** Today as `YYYY-MM-DD` in the device's own zone — the unit a daily nudge counts in. */
function localToday(): string {
  try {
    return new Intl.DateTimeFormat('en-CA').format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * A dismissal that only lasts the day. The prompt can be closed, but the close
 * is good until midnight: we store the day it was closed on and show the card
 * again on any later day. So a guest is nudged once a day — not nagged on every
 * open, and not silenced for good. `ready` gates the first paint so the card
 * never flashes in and then vanishes when a same-day dismissal loads a beat later.
 */
function useDailyDismiss(key: string): { hidden: boolean; ready: boolean; dismiss: () => void } {
  const [dismissedOn, setDismissedOn] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key)
      .then((value) => {
        if (alive) setDismissedOn(value);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [key]);
  const dismiss = useCallback(() => {
    const today = localToday();
    setDismissedOn(today);
    void AsyncStorage.setItem(key, today).catch(() => {});
  }, [key]);
  return { hidden: dismissedOn === localToday(), ready, dismiss };
}

/**
 * The guest's standing prompt — a neutral welcome card, not a second brand block.
 *
 * The balance hero right below it wears the brand wash. The old banner sat in
 * `brandSoft`, so the top of a guest's screen was two purple blocks with no
 * hierarchy — the thing the user flagged. This sits quiet in `surface` behind a
 * hairline with a brand icon chip, so the coloured balance reads as the hero and
 * this reads as the aside: the colour-hero-then-neutral-prompt rhythm the finance
 * references lean on (Starling's welcome card over its balance, Buddy's white
 * setup card under its total).
 *
 * A progress bar draws the trial running down — filled for the time left, so a
 * shrinking bar is the countdown you feel at a glance, not a number you have to
 * read. It empties and turns to warning as the days run out, and once the trial
 * is spent the whole card does (the chip, the bar), so "read-only" lands as a
 * real state rather than decoration.
 *
 * The card carries a close: a guest can dismiss it, but only for the day — it
 * returns tomorrow (see `useDailyDismiss`).
 */
function GuestPopup({
  gate,
  t,
  onAction,
}: {
  gate: GuestGate | null;
  t: UiStrings;
  onAction: () => void;
}) {
  const theme = useTheme();
  const { hidden, ready, dismiss } = useDailyDismiss(GUEST_PROMPT_DISMISS_KEY);
  // Take a turn in the shared prompt queue rather than firing on its own: the
  // guest card waits behind the tour and the push/campaign asks and only shows
  // when it is the live winner. `active` is exactly "would show today" (ready and
  // not dismissed), so it never holds the queue — and blocks the lower-priority
  // tip — while it is hidden for the day.
  const wants = ready && !hidden;
  const granted = usePromptSlot({ id: 'guest', priority: 40, active: wants, delayMs: 300 });
  const visible = wants && granted;

  if (!visible) return null;

  const expired = gate?.expired ?? false;
  const body = expired
    ? t.tabs.guestReadOnly
    : gate
      ? t.tabs.guestDaysLeft.replace('{days}', String(gate.daysLeft))
      : t.tabs.guestBannerBody;

  return (
    <Popup
      visible
      onClose={dismiss}
      closeLabel={t.entry.notifyNotNow}
      style={{ maxWidth: 360, alignItems: 'center', gap: theme.spacing.lg }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: theme.color.buttonPrimary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name={expired ? 'lock-closed' : 'shield-checkmark'}
          size={38}
          color={expired ? theme.color.warning : theme.color.onBrand}
        />
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="heading" align="center">
          {t.tabs.addYourDetails}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {body}
        </Text>
      </View>

      <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm }}>
        <Button label={t.signIn.createAccount} size="lg" fullWidth onPress={onAction} />
        <Button
          label={t.entry.notifyNotNow}
          variant="ghost"
          size="lg"
          fullWidth
          onPress={dismiss}
        />
      </View>
    </Popup>
  );
}

export default withScenic(HomeScreen);
