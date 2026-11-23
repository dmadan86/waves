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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurTargetView } from 'expo-blur';
import { Animated, InteractionManager, Pressable, RefreshControl, View } from 'react-native';

import { fallbackCurrency, type GuestGate } from '@waves/core';
import { Button, Popup, Row, Screen, Text, useTabBarClearance, useTheme } from '@waves/ui';

import { useGroups, useHomeSummary, useNewestActivityFromOthers } from '@/data/hooks';
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
import { SPEC_INK } from '@/lib/specPalette';
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
import { HeroIconButton } from '@/components/home/HeroControls';
import { SpaceSwitchSheet } from '@/components/SpaceSwitcher';
import { COMPANIES_ENABLED } from '@/lib/companiesEnabled';
import { PersonAvatar } from '@/components/PersonAvatar';
import { HomeHeroBackground } from '@/components/home/HomeHeroBackground';
import { NewGroupMenu, type MenuAnchor } from '@/components/home/NewGroupMenu';
import { greetingLine } from '@/lib/greetingLine';
import { HomeQuickActions } from '@/components/home/HomeQuickActions';
import { ComingUpChips, NeedsYouCard } from '@/components/home/HomeToday';
import { SpacesGrid } from '@/components/home/HomeSpaces';
import { useHomeSpaceFigures } from '@/data/homeSpaces';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { DateReminderCard } from '@/components/dates/DateReminderCard';
import { TipSheet } from '@/components/home/TipSheet';
import { useHeroStatusBar } from '@/components/ScenicScreenHero';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { useVoiceNewCount } from '@/lib/voiceSpaceStore';
import { BackupReminder } from '@/components/BackupReminder';
import { RestorePrompt } from '@/components/RestorePrompt';
import { useBalanceHidden } from '@/lib/balanceHidden';
import { usePullRefresh } from '@/lib/pullRefresh';

/** Dashboard route with duplicate-safe jumps to stable primary destinations. */
function HomeScreen() {
  const theme = useTheme();
  const pull = usePullRefresh();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { session, profile, isGuest } = useAuth();
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
  const insets = useSafeAreaInsets();
  // The eye toggle: hide the money on a shared screen, remembered across opens.
  const { hidden: balanceHidden, ready: balanceReady, toggle: toggleBalance } = useBalanceHidden();
  // The time-of-day line under the name. The *bucket* is sampled once on mount
  // (lazy init, never a bare Date in render — the React Compiler lints that),
  // then the localised word is read at render so it follows a language change.
  const [greetKey] = useState<'morning' | 'afternoon' | 'evening'>(() => {
    const hour = new Date().getHours();
    return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  });
  const displayName = profile?.display_name ?? t.account.you;
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
    // Exempt from the one-prompt-per-launch allowance: the intro that just closed
    // spent it, and the tour must still follow it on a first run.
    essential: true,
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
  const [needsBills, setNeedsBills] = useState('');
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
  const headline = summary.totals[0] ?? {
    currency: defaultCurrency,
    net: 0n,
    owed: 0n,
    owing: 0n,
  };

  // Which photograph the hero wears: the clock's (and region's), or the one
  // picked on the Background screen.
  const hero = useHomeHero();
  // The hero's geometry, measured: the scene runs from the top of the screen
  // down to the lower part of the balance card, and needs to know where the
  // greeting row ends and where the card begins to place its layers.
  const sceneRef = useRef<View>(null);
  const [headerHeight, setHeaderHeight] = useState(insets.top + 56);
  const [greetingHeight, setGreetingHeight] = useState(46);
  const [cardHeight, setCardHeight] = useState(280);
  // The fixed header is just the greeting row; the card starts right under it.
  const cardTop = headerHeight;
  const sceneHeight = cardTop + cardHeight * SCENE_INTO_CARD;
  // The photograph runs up under the status bar behind a dark scrim, so the
  // clock, battery and greeting are white on every scene.
  const darkInk = false;
  const heroInk = darkInk ? SPEC_INK : '#FFFFFF';
  const [scrollY] = useState(() => new Animated.Value(0));
  const [headerOpaque, setHeaderOpaque] = useState(false);
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 24],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const heroInkOpacity = scrollY.interpolate({
    inputRange: [0, 24],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const solidInkOpacity = scrollY.interpolate({
    inputRange: [0, 24],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  useEffect(() => {
    const listener = scrollY.addListener(({ value }) => setHeaderOpaque(value >= 24));
    return () => scrollY.removeListener(listener);
  }, [scrollY]);
  useHeroStatusBar(headerOpaque && theme.scheme !== 'dark' ? 'dark' : 'light');

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
  // headline's currency, the one those sides are totalled in.
  const inHeadline = list.filter(
    // The same fallback the totals key a group by, so a group with no
    // currency set is counted where its balance was summed.
    (group) => (group.default_currency ?? fallbackCurrency()) === headline.currency,
  );
  const owedGroups = inHeadline.filter((group) => summary.balanceFor(group.id) > 0n).length;
  const owingGroups = inHeadline.filter((group) => summary.balanceFor(group.id) < 0n).length;

  // Home's feed: the personal ledger (for Personal's tile and the bills that
  // need paying), the pooled groups' figures, and whether there is anything yet.
  const ledger = usePersonalLedger();
  const [today] = useState(() => todayIso());
  const figures = useHomeSpaceFigures();
  const { hidden: personalHidden } = usePersonalAmountsHidden();
  const amountsHidden = balanceHidden || !balanceReady;
  const todayLedger = {
    txns: ledger.txns,
    recurrings: ledger.recurrings,
    budgets: ledger.budgets,
    currency: defaultCurrency,
    today,
  };
  const newUser =
    list.length === 0 &&
    ledger.txns.length === 0 &&
    ledger.recurrings.length === 0 &&
    ledger.budgets.length === 0;

  if (coldStartHold) return <Screen edges={[]}>{null}</Screen>;

  return (
    <Screen edges={[]}>
      {/* Keep the scene fixed behind the greeting and as the balance card's
          blur target. The feed scrolls beneath the fixed greeting row. */}
      <View style={{ flex: 1 }}>
        <BlurTargetView
          ref={sceneRef}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: sceneHeight }}
        >
          <HomeHeroBackground
            hero={hero}
            height={sceneHeight}
            photoHeight={Math.min(220, Math.max(180, headerHeight + 20))}
            scrimHeight={insets.top + theme.spacing.sm + greetingHeight}
            pageColor={theme.color.bg}
          />
        </BlurTargetView>
        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: clearance }}
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={theme.color.brand}
            />
          }
        >
          {/* Room for the fixed greeting row; the card sits right under it. */}
          <View style={{ height: headerHeight }} />

          {/* The body on the lavender canvas. A list gutter (`lg`, 16pt), the
            phone margin iOS and Android both default to. */}
          <View
            style={{
              paddingHorizontal: theme.spacing.lg,
              gap: theme.spacing.xs,
            }}
          >
            {/* The tour's "hero" anchor is the balance card, so the first
              coach-mark still spotlights the balance. */}
            <View onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}>
              <TourTarget id="hero">
                <HomeBalanceCard
                  net={headline.net}
                  owed={headline.owed}
                  owing={headline.owing}
                  owedGroups={owedGroups}
                  owingGroups={owingGroups}
                  currency={headline.currency}
                  locale={locale}
                  hidden={balanceHidden || !balanceReady}
                  onToggleHide={toggleBalance}
                  settling={settling}
                  catchUp={catchUp}
                  loading={showSkeleton || !balanceReady}
                  blurTarget={sceneRef}
                  footer={
                    <HomeQuickActions
                      // The quick sheet, not the capture screen: most spends know
                      // where they belong and need an amount and a place. The long
                      // press raises type / scan / speak, unchanged.
                      onAddExpense={() => setQuickExpenseOpen(true)}
                      onAddExpenseLong={() => setQuickAddOpen(true)}
                      onSettleUp={() => router.push('/settle-up')}
                      onReview={() => router.navigate('/captures')}
                      onScan={() => router.push(`/capture?scan=${Date.now()}`)}
                      onRemind={() => switchTab('/(tabs)/friends')}
                      radius={theme.radius.xl}
                    />
                  }
                />
              </TourTarget>
            </View>

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

            {showSkeleton ? (
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
                    onShownBills={setNeedsBills}
                  />
                )}
                {newUser ? null : (
                  <ComingUpChips ledger={todayLedger} hidden={amountsHidden} exclude={needsBills} />
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
          </View>
        </Animated.ScrollView>
        <View
          onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1,
            elevation: 4,
            paddingTop: insets.top + theme.spacing.xs,
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.xs,
          }}
        >
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -insets.top,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: theme.color.bg,
              opacity: headerOpacity,
              borderBottomWidth: 1,
              borderBottomColor: theme.color.border,
            }}
          />
          <Row
            onLayout={(event) => setGreetingHeight(event.nativeEvent.layout.height)}
            style={{ alignItems: 'center', gap: theme.spacing.md }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.profile}
              onPress={() => router.navigate('/profile')}
              hitSlop={8}
              style={{ flex: 1, minWidth: 0 }}
            >
              <Animated.View style={{ opacity: heroInkOpacity }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: heroInk,
                    fontSize: 20,
                    lineHeight: 26,
                    fontWeight: '700',
                    textShadowColor: 'rgba(0,0,0,0.35)',
                    textShadowOffset: { width: 0, height: 1 },
                    textShadowRadius: 4,
                  }}
                >
                  {greetingLine(t.dashHero[greetKey], profile?.display_name, locale)}
                </Text>
              </Animated.View>
              <Animated.View
                pointerEvents="none"
                style={{ position: 'absolute', left: 0, right: 0, opacity: solidInkOpacity }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.color.text,
                    fontSize: 20,
                    lineHeight: 26,
                    fontWeight: '700',
                  }}
                >
                  {greetingLine(t.dashHero[greetKey], profile?.display_name, locale)}
                </Text>
              </Animated.View>
            </Pressable>
            <View>
              <Animated.View style={{ opacity: heroInkOpacity }}>
                <HeroIconButton
                  icon="notifications-outline"
                  label={unseenActivity ? `${t.activity}, ${t.tagNew}` : t.activity}
                  onPress={() => router.navigate('/activity')}
                  dot={unseenActivity}
                  ink={heroInk}
                />
              </Animated.View>
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  padding: theme.spacing.xs,
                  opacity: solidInkOpacity,
                }}
              >
                <Ionicons name="notifications-outline" size={24} color={theme.color.text} />
                {unseenActivity ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: theme.spacing.xs,
                      end: theme.spacing.xs,
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: '#FF3B5C',
                    }}
                  />
                ) : null}
              </Animated.View>
            </View>
            <View>
              <Animated.View style={{ opacity: heroInkOpacity }}>
                <HeroIconButton
                  icon="ellipsis-vertical"
                  label={t.account.faceSettings}
                  onPress={() => setMenuOpen(true)}
                  ink={heroInk}
                />
              </Animated.View>
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  padding: theme.spacing.xs,
                  opacity: solidInkOpacity,
                }}
              >
                <Ionicons name="ellipsis-vertical" size={24} color={theme.color.text} />
              </Animated.View>
            </View>
          </Row>
        </View>
      </View>

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

/** How far down the balance card the scene reaches before it has faded into
 *  the page — its lower part, never on behind the groups. */
const SCENE_INTO_CARD = 0.72;

export default withScenic(HomeScreen);
