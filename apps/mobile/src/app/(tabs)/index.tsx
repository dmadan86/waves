import { useQueryClient } from '@tanstack/react-query';
import { adGateQuery } from '@/lib/adGateQuery';
import { useEntitlement } from '@/lib/useEntitlement';
import { useFlagEnabled } from '@/lib/flags';
import { AdSlot } from '@/components/AdSlot';
import { useAdPlan } from '@/lib/useAdPlan';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Animated,
  InteractionManager,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';

import { dayNumber, type GuestGate } from '@waves/core';
import {
  Button,
  directionalIcon,
  iconSize,
  MoneyText,
  Popup,
  Row,
  Screen,
  Skeleton,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useCaptures, useGroups, useHomeSummary, useNewestActivityFromOthers } from '@/data/hooks';
import { useRecurringCatchUp } from '@/data/groupRecurring';
import { hasUnseenActivity, useActivitySeenAt } from '@/lib/activitySeen';
import { useGroupUnread } from '@/lib/useGroupUnread';
import { UnreadDot } from '@/components/UnreadDot';
import { orderByActivity } from '@/lib/groupActivityOrder';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { trialDaysLeft } from '@/lib/proTrial';
import { useProTrial } from '@/lib/useProTrial';
import { useAuth } from '@/lib/auth';
import { useGuestGuard } from '@/lib/guestGuard';
import { router } from '@/lib/navigation';
import { useNavigation } from 'expo-router';
import { usePromptSlot } from '@/lib/promptQueue';
import { TourTarget, useTour } from '@/lib/tour';
import { tourMayStart, useOverlayBusy } from '@/lib/firstRun';
import { GroupMark } from '@/components/GroupMark';
import { useCoverTile } from '@/lib/groupCoverColor';
import { useViewerCompanyIds } from '@/lib/useCompanyTab';
import { groupsOutsideCompanies } from '@/lib/spaces';
import { useColdStartSpace } from '@/lib/useSpaces';
import { ImportProgressBanner } from '@/components/ImportProgressBanner';
import { LinkRequestsCard } from '@/components/LinkRequestsCard';
import { SkeletonList } from '@/components/Skeletons';
import { useImportedGroupId } from '@/lib/importProgress';
import { useReducedMotion } from '@/lib/reducedMotion';
import { useReferralsLive } from '@/lib/useReferralsLive';
import { THEME_HIDDEN } from '@/lib/theme';
import { useDefaultCurrency } from '@/lib/currency';
import { QuickAddSheet, useQuickAddActions } from '@/components/QuickAddSheet';
import { QuickExpenseSheet } from '@/components/QuickExpenseSheet';
import { BALANCE_MASK, HomeBalanceCard } from '@/components/home/HomeBalanceCard';
import { SpacePill, SpaceSwitchSheet } from '@/components/SpaceSwitcher';
import { SectionHeader } from '@/components/standard';
import { TabHeader, TabIconButton } from '@/components/home/TabHeader';
import { PersonAvatar } from '@/components/PersonAvatar';
import { NewGroupMenu, type MenuAnchor } from '@/components/home/NewGroupMenu';
import { HomeQuickActions } from '@/components/home/HomeQuickActions';
import { TipSheet } from '@/components/home/TipSheet';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { BackupReminder } from '@/components/BackupReminder';
import { RestorePrompt } from '@/components/RestorePrompt';
import { groupLabel, GroupType } from '@/data/types';
import { GroupTypeTag, useGroupTypeTag, useGroupTypeTagSpoken } from '@/components/GroupTypeTag';
import { useBalanceHidden } from '@/lib/balanceHidden';
import { usePullRefresh } from '@/lib/pullRefresh';

/** Dashboard route with duplicate-safe jumps to stable primary destinations. */
export default function HomeScreen() {
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
  // The time-of-day line under the name. The *bucket* is sampled once on mount
  // (lazy init, never a bare Date in render — the React Compiler lints that),
  // then the localised word is read at render so it follows a language change.
  // Drafts (A34) belong to the person, not the group, so they come from the
  // captures read and are counted per destination here — one pass, rather than
  // a filter inside every row.
  const captures = useCaptures();
  const draftsByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const capture of captures.data) {
      const target = capture.target_group_id;
      if (target) counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    return counts;
  }, [captures.data]);

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
  // Same test the Upgrade screen uses for `plansLive`: the paywall flag is on
  // and this build can buy. A guest signs up first, so the row waits for that.
  const canUpgrade = useReferralsLive() && !isGuest;
  const proTrial = useProTrial();
  const [switchOpen, setSwitchOpen] = useState(false);
  const menuItems: OverflowMenuItem[] = useMemo(
    () => [
      // Opens the Switch space sheet; OverflowMenu closes first, then runs this.
      {
        icon: 'swap-horizontal-outline',
        label: t.spaces.pillLabel,
        onPress: () => setSwitchOpen(true),
        section: 'space',
      },
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
  const openNewGroup = (): void => {
    if (guard.blockAddGroup()) return;
    router.push('/new-group');
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

  // The ids of the trips running today, so their rows can wear an "on trip"
  // tag. "Running" is decided in the trip's own timezone, not the phone's — a
  // Goa trip run from Dubai turns over at midnight in Goa (the same rule
  // `dayNumber` and the planner already use).
  const ongoingTripIds = new Set(
    list
      .filter((g) => g.type === GroupType.Trip && g.start_date && g.end_date)
      .filter((g) => dayNumber(todayIn(g.time_zone), g.start_date, g.end_date) !== null)
      .map((g) => g.id),
  );
  // "Now" sampled once per mount (a lazy initial state, never re-read as a ref
  // in render) so the "New" window is stable across this screen's renders and
  // the React Compiler stays happy — a bare Date.now() in render trips its lint.
  const [nowMs] = useState(() => Date.now());
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
  const unreadBeyondPreview = list
    .slice(GROUPS_PREVIEW)
    .some((group) => unreadGroups.has(group.id));

  if (coldStartHold) return <Screen edges={[]}>{null}</Screen>;

  return (
    <Screen edges={[]}>
      <View style={{ flex: 1 }}>
        {/* The tab header: space pill at the start, news and the menu at the end. */}
        <TabHeader left={<SpacePill current="personal" label={t.spaces.personal} />}>
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
        </TabHeader>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
            paddingBottom: clearance,
            gap: theme.spacing.lg,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={theme.color.brand}
            />
          }
        >
          {/* The tour's "hero" anchor is the balance, so the first coach-mark
              still spotlights it. */}
          <TourTarget id="hero">
            <HomeBalanceCard
              net={headline.net}
              owed={headline.owed}
              owing={headline.owing}
              currency={headline.currency}
              locale={locale}
              hidden={balanceHidden || !balanceReady}
              onToggleHide={toggleBalance}
              settling={settling}
              loading={showSkeleton || !balanceReady}
              footer={
                <HomeQuickActions
                  // The quick sheet, not the capture screen: most spends know
                  // where they belong and need an amount and a place. The long
                  // press raises type / scan / speak, unchanged.
                  onAddExpense={() => setQuickExpenseOpen(true)}
                  onAddExpenseLong={() => setQuickAddOpen(true)}
                  onSettleUp={() => router.push('/settle-up')}
                  onReview={() => router.navigate('/captures')}
                  onNewGroup={openNewGroupMenu}
                />
              }
            />
          </TourTarget>

          {/* A background import's progress lands here, just above the groups —
              the person tapped Import, came home, and watches it fill. */}
          <ImportProgressBanner />

          {/* "Madan says you are Renny in Goa trip": somebody has named this
              person as a placeholder in their group, and only they can say
              yes. Drawn only while something is waiting. */}
          <LinkRequestsCard enabled={session !== null && !isGuest} />

          {showSkeleton ? (
            <SkeletonList rows={3} />
          ) : list.length === 0 ? (
            // The one screen where somebody has nothing to act on yet gets the
            // action spelled out.
            <View style={{ alignItems: 'center', gap: theme.spacing.sm, paddingTop: theme.spacing.xl }}>
              <Text variant="heading" accessibilityRole="header" align="center">
                {t.tabs.noGroups}
              </Text>
              <Text variant="body" tone="muted" align="center">
                {t.tabs.noGroupsBody}
              </Text>
              <Button label={t.newGroup} onPress={openNewGroup} />
            </View>
          ) : (
            <View style={{ gap: theme.spacing.xs }}>
              {/* The heading carries the door to the full list: this is a
                  capped preview, "All groups" opens the whole roster. */}
              <SectionHeader
                title={t.yourGroups}
                trailing={
                  <Pressable
                    onPress={() => router.navigate('/groups')}
                    accessibilityRole="button"
                    accessibilityLabel={
                      unreadBeyondPreview ? `${t.allGroups}, ${t.groupNewActivity}` : t.allGroups
                    }
                    hitSlop={8}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 2,
                      opacity: pressed ? 0.5 : 1,
                    })}
                  >
                    {/* Only when the news is in a group the preview cuts off:
                        a row above already wears its own dot. */}
                    {unreadBeyondPreview ? (
                      <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          marginEnd: 4,
                          backgroundColor: theme.color.negative,
                        }}
                      />
                    ) : null}
                    <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                      {t.allGroups}
                    </Text>
                    <Ionicons
                      name={directionalIcon('chevron-forward')}
                      size={iconSize.sm}
                      color={theme.color.brand}
                    />
                  </Pressable>
                }
              />
              {/* Divided rows on the page itself, not a card. */}
              <View>
            {list.slice(0, GROUPS_PREVIEW).map((group, index) => {
              const members = summary.membersFor(group.id);
              const balance = summary.balanceFor(group.id);
              // A running trip earns a live "on trip" tag; failing that, a
              // just-made group wears "New" for its first couple of days.
              // The demo group outranks both — it is never "New" and
              // never genuinely "on trip", and it needs to read as
              // what it is before anything else about the row does.
              const onTrip = ongoingTripIds.has(group.id);
              const isNew = nowMs - Date.parse(group.created_at) < NEW_GROUP_WINDOW_MS;
              const tag = group.isDemo
                ? t.demo.badge
                : onTrip
                  ? t.tagOnTrip
                  : isNew
                    ? t.tagNew
                    : null;
              return (
                <Fragment key={group.id}>
                  <GroupRow
                    title={groupLabel(group, members, viewerId)}
                    memberLabel={plural(
                      locale,
                      summary.memberCountFor(group.id),
                      t.memberCount,
                    )}
                    draftLabel={
                      draftsByGroup.has(group.id)
                        ? plural(locale, draftsByGroup.get(group.id) ?? 0, t.draftCount)
                        : null
                    }
                    coverEmoji={group.cover_emoji}
                    coverColor={group.cover_color}
                    groupType={group.type}
                    eventTemplate={group.event_template}
                    customTag={group.custom_tag}
                    balance={balance}
                    currency={group.default_currency}
                    locale={locale}
                    statusLabel={
                      balance === 0n ? t.allSettled : balance > 0n ? t.youAreOwed : t.youOwe
                    }
                    directionLabel={
                      balance === 0n
                        ? t.group.rowSettled
                        : balance > 0n
                          ? t.group.rowOwed
                          : t.group.rowYouOwe
                    }
                    pendingLabel={summary.hasPending(group.id) ? t.pendingConfirmation : null}
                    tag={tag}
                    isDemo={group.isDemo === true}
                    tagTone={group.isDemo ? 'warning' : onTrip ? 'positive' : 'brand'}
                    divider={index > 0}
                    // The eye in the hero shuts the whole screen's money, not
                    // just the headline: masking one figure while twelve sit
                    // uncovered below it is privacy theatre. Masked too until
                    // the saved preference has loaded — `balanceHidden` starts
                    // false while AsyncStorage resolves, so without the
                    // `!balanceReady` guard a hidden balance flashes in plain
                    // before the eye's state lands. The hero is already gated
                    // this way upstream (it shows its skeleton until ready).
                    hidden={balanceHidden || !balanceReady}
                    // The just-imported group slides and fades into place
                    // rather than blinking in under the success banner.
                    enter={group.id === justAddedId}
                    // Its balance materialises a beat after the group row does,
                    // so mask the amount until the ledger lands rather than show
                    // a confident wrong ₹0 that then jumps to the real figure.
                    pendingBalance={group.id === justAddedId && !summary.hasLedger(group.id)}
                    onPress={() => router.push(`/group/${group.id}`)}
                    unread={unreadGroups.has(group.id)}
                  />
                  {/* One native card inside the list (>= 10 groups), never on the row that is sliding in. */}
                  {homeAdSlot === index + 1 && justAddedId == null ? (
                    <View style={{ paddingHorizontal: theme.spacing.sm }}>
                      <AdSlot
                        handle={homeAds}
                        format="native"
                        slot={index + 1}
                        rowGap={theme.spacing.sm}
                      />
                    </View>
                  ) : null}
                </Fragment>
              );
            })}
              </View>
            </View>
          )}
        </ScrollView>
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
        onCreate={openNewGroup}
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

/** How long after creation a group still counts as "New" — 48 hours. */
const NEW_GROUP_WINDOW_MS = 48 * 60 * 60 * 1000;

/** How many groups the dashboard shows inline before deferring to the full
    "All groups" screen — enough to cover most people's active set without the
    home list growing without bound. */
const GROUPS_PREVIEW = 15;

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

/** Today as `YYYY-MM-DD` in a given timezone, never the server's. */
function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * One group as a clean list row — an emoji chip, the name over its member count
 * and standing, the balance to the right coloured by who owes whom. The banking
 * "recent" row applied to a group; the whole row is the tap into the group.
 */
function GroupRow({
  title,
  memberLabel,
  draftLabel,
  coverEmoji,
  coverColor,
  groupType,
  eventTemplate,
  customTag,
  balance,
  currency,
  locale,
  statusLabel,
  directionLabel,
  pendingLabel,
  tag,
  tagTone,
  isDemo = false,
  divider,
  enter = false,
  pendingBalance = false,
  hidden = false,
  onPress,
  unread = false,
}: {
  title: string;
  memberLabel: string;
  /** "2 drafts" when this group has money caught but not yet entered, else
   *  null. Worth a place on the row because a draft is the one thing here that
   *  is waiting on the reader. */
  draftLabel: string | null;
  coverEmoji: string | null;
  coverColor: string | null | undefined;
  /** What kind of group — drawn as a small tag on the member-count line. */
  groupType: string | null | undefined;
  eventTemplate: string | null | undefined;
  customTag: string | null | undefined;
  balance: bigint;
  currency: string;
  locale: string;
  /** "You are owed" — spoken, in the row's accessibility label. */
  statusLabel: string;
  /** "owed" — the same standing, drawn small under the amount it describes. */
  directionLabel: string;
  pendingLabel: string | null;
  tag: string | null;
  tagTone: 'positive' | 'brand' | 'neutral' | 'warning';
  /** The sample group: "sample data" subtitle. */
  isDemo?: boolean;
  /** The dashboard's eye is shut: show the mask in place of the amount. The
      row's standing ("You owe") stays — it is the figure that is private. */
  hidden?: boolean;
  /** True while this group's balance is still materialising (just after an
      import): the amount is masked with a skeleton instead of a wrong zero. */
  pendingBalance?: boolean;
  /** A hairline above the row — every row but the first, so the card reads as
      one divided list rather than a stack of loose cards. */
  divider: boolean;
  /** True for a row that has just arrived (a fresh import): it fades and slides
      into place on mount rather than blinking in. */
  enter?: boolean;
  onPress: () => void;
  /** Someone else has done something here since the reader last opened it:
      a dot on the icon, a heavier name, and said aloud. */
  unread?: boolean;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { t } = useStrings();

  // The entrance: start dropped and clear, settle into place. Only for a row
  // flagged `enter` (a just-imported group), and never under reduce motion —
  // otherwise the row is static at rest. Lazy-init state, never a ref read in
  // render (the React Compiler lints that), transform+opacity native-driven.
  const shouldAnimate = enter && !reduceMotion;
  const anim = useState(() => new Animated.Value(shouldAnimate ? 0 : 1))[0];
  useEffect(() => {
    if (!shouldAnimate) return;
    const run = Animated.spring(anim, {
      toValue: 1,
      friction: 8,
      tension: 60,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [shouldAnimate, anim]);

  // What the row says under its title: who is in it and what is waiting. Where
  // it stands moved under the amount — "owed" beside the figure it describes,
  // the way an expense row says "you lent" — rather than "You are owed" on
  // every line of the list. The spoken label still carries it in full: a screen
  // reader is given the label instead of the text inside the row, so anything
  // said only on screen is not said quietly, it is not said.
  const tile = useCoverTile(coverColor, theme.color.surfaceMuted);
  const typeTag = useGroupTypeTag(groupType, eventTemplate, customTag);
  const typeSpoken = useGroupTypeTagSpoken(typeTag);
  const spoken =
    pendingLabel ?? [typeSpoken, memberLabel, draftLabel, statusLabel].filter(Boolean).join(' · ');

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}${unread ? `, ${t.groupNewActivity}` : ''}. ${spoken}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          borderTopWidth: divider ? 1 : 0,
          borderTopColor: theme.color.border,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radius.md,
            backgroundColor: tile.backgroundColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GroupMark emoji={coverEmoji} size={20} color={tile.ink} />
          {unread ? <UnreadDot /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            {/* A step heavier while unread — the chat-list cue — so the dot
                is not the only thing saying it. */}
            <Text
              variant="body"
              numberOfLines={1}
              style={{ flexShrink: 1, fontWeight: unread ? '700' : '500' }}
            >
              {title}
            </Text>
            {tag ? (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: 6,
                  backgroundColor:
                    tagTone === 'positive'
                      ? theme.color.positiveSoft
                      : tagTone === 'warning'
                        ? theme.color.warningSoft
                        : tagTone === 'neutral'
                          ? theme.color.surfaceMuted
                          : theme.color.brandSoft,
                }}
              >
                <Text
                  variant="micro"
                  tone={
                    tagTone === 'positive' ? 'positive' : tagTone === 'neutral' ? 'muted' : 'brand'
                  }
                  style={{
                    fontWeight: '700',
                    ...(tagTone === 'warning' ? { color: theme.color.warning } : null),
                  }}
                >
                  {tag}
                </Text>
              </View>
            ) : null}
          </Row>
          {/* Words only. A stack of faces sat here for a while, on the theory
              that you recognise a group by who is in it; on the row it read as
              clutter beside a line that already says how many and where you
              stand. */}
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            {typeTag ? <GroupTypeTag tag={typeTag} /> : null}
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {isDemo ? t.demo.rowSubtitle : (pendingLabel ?? memberLabel)}
              {/* A draft is the one thing here waiting on the reader, so it is
                said in the warning's orange rather than the muted grey. */}
              {!pendingLabel && draftLabel ? (
                <Text variant="caption" style={{ color: theme.color.warning, fontWeight: '600' }}>
                  {` · ${draftLabel}`}
                </Text>
              ) : null}
            </Text>
          </Row>
        </View>
        {pendingBalance ? (
          <Skeleton width={64} height={16} radius={6} animated={!reduceMotion} />
        ) : (
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            {hidden ? (
              <Text tone="muted" style={{ fontWeight: '700' }}>
                {BALANCE_MASK}
              </Text>
            ) : (
              // `balance` mode is money's own rule in one place: it takes the
              // magnitude, colours by the sign (owed-to-you positive, you-owe
              // negative, square quiet) and speaks the direction aloud.
              <MoneyText
                amount={balance}
                currency={currency as never}
                locale={locale}
                mode="balance"
                fadeFraction={false}
                style={{ fontWeight: '700' }}
              />
            )}
            {/* The standing in words, under the figure. The amount carries no
                sign, so without this the direction would be colour alone. Kept
                when the eye is shut: the figure is private, the side is not. */}
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {directionLabel}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
