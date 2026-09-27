import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Animated, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { dayNumber, format, money, type GuestGate } from '@waves/core';
import {
  Avatar,
  Button,
  directionalIcon,
  EmptyState,
  Gradient,
  iconSize,
  Popup,
  Row,
  Screen,
  Sheet,
  Skeleton,
  Text,
  tints,
  type TintName,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useCaptures, useGroups, useHomeSummary, usePinnedGroupIds } from '@/data/hooks';
import { orderByActivity } from '@/lib/groupActivityOrder';
import { orderByPin } from '@/lib/groupPinOrder';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useGuestGuard } from '@/lib/guestGuard';
import { router } from '@/lib/navigation';
import { usePromptSlot } from '@/lib/promptQueue';
import { useDashboardTips } from '@/lib/tips';
import { TourTarget, useTour } from '@/lib/tour';
import { GroupMark } from '@/components/GroupMark';
import { SyncStatusIcon } from '@/components/SyncBanner';
import { ImportProgressBanner } from '@/components/ImportProgressBanner';
import { SkeletonList } from '@/components/Skeletons';
import { useImportedGroupId } from '@/lib/importProgress';
import { useReducedMotion } from '@/lib/reducedMotion';
import { THEME_HIDDEN } from '@/lib/theme';
import { useDefaultCurrency } from '@/lib/currency';
import { QuickAddSheet, useQuickAddActions } from '@/components/QuickAddSheet';
import { QuickExpenseSheet } from '@/components/QuickExpenseSheet';
import { BALANCE_MASK, HomeBalanceCard } from '@/components/home/HomeBalanceCard';
import { HomeQuickActions } from '@/components/home/HomeQuickActions';
import { relativeUnit } from '@/lib/homeDashboard';
import { SettlePickerSheet, type SettleCandidate } from '@/components/home/SettlePickerSheet';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { RestorePrompt } from '@/components/RestorePrompt';
import { useAvatarUrl } from '@/components/ProfileAvatar';
import { groupLabel, GroupType } from '@/data/types';
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
  // The header avatar sits in the private bucket, so its path has to be signed
  // before an Image can show it — the same resolution the profile screen does.
  // Without this the dashboard falls back to initials while settings shows the
  // photo, which reads as the picture "not loading" on the home screen.
  const avatarUrl = useAvatarUrl(profile?.avatar_url);

  const groups = useGroups();
  // Which groups this person has pinned. Read
  // once here rather than per row: every row asks the same `Set.has`, and the
  // preview's own order depends on it before any row exists to ask.
  const pinnedIds = usePinnedGroupIds();
  const summary = useHomeSummary(viewerId);
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

  const [greetKey] = useState<'morning' | 'afternoon' | 'evening'>(() => {
    const hour = new Date().getHours();
    return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  });
  const displayName = profile?.display_name ?? t.account.you;

  /**
   * Most recently used first, then pins in front of that.
   *
   * The order groups arrive in is `created_at` — the day you were *added* to
   * one, which says nothing about whether you use it. With only
   * GROUPS_PREVIEW slots that meant a trip that ended in March could hold a
   * row for a year while the flat you settle up in weekly fell off the
   * bottom, and pinning was the only cure. Ordering by when each ledger last
   * moved lets a dormant group sink on its own and brings it straight back
   * the moment somebody spends — without hiding anything, because a settled
   * group is not a finished one.
   *
   * Both steps run *before* the slice: pinning and recency are precisely
   * arguments about which groups deserve the limited slots, so they have to be
   * settled while there are still rows to lose.
   */
  const list = useMemo(() => {
    const byActivity = orderByActivity(groups.data ?? [], (group) =>
      summary.lastActivityFor(group.id),
    );
    return orderByPin(byActivity, (group) => pinnedIds.has(group.id));
  }, [groups.data, pinnedIds, summary]);
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
  const tourStarted = useRef(false);
  useEffect(() => {
    if (tourStarted.current) return;
    if (tour.ready && !tour.seen && !showSkeleton && balanceReady) {
      tourStarted.current = true;
      tour.start();
    }
  }, [tour.ready, tour.seen, tour, showSkeleton, balanceReady]);

  // The tour holds the top of the prompt queue for the whole of a first run —
  // from the moment we know it is owed (ready, not seen), through the wait for
  // data and the tour itself, until it finishes and marks itself seen. While it
  // holds the slot the daily tip stands down; see `TipSheet`.
  usePromptSlot({ id: 'tour', priority: 100, active: tour.active || (tour.ready && !tour.seen) });

  // The header overflow menu (the three-dot dropdown): the settings and the
  // less-used destinations, surfaced from the dashboard rather than only from
  // the profile tab.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuItems: OverflowMenuItem[] = useMemo(
    () => [
      // The `section` keys are internal grouping only (not user-visible): they
      // cluster the rows into account / data / app / settings, and
      // OverflowMenu draws a divider wherever two adjacent rows fall in
      // different sections.
      //
      // No "actions" rows: scan to join, scan bill, bank messages and settle up
      // all have homes of their own (Friends' add sheet, the + Expense hold,
      // Review, a group's settle), so the menu is settings and destinations only.
      {
        icon: 'person-circle-outline',
        label: t.account.yourAccount,
        route: '/settings/account',
        section: 'account',
      },
      {
        icon: 'notifications-outline',
        label: t.account.notifications,
        route: '/settings/notifications',
        section: 'account',
      },
      {
        icon: 'archive-outline',
        label: t.group.archivedTitle,
        route: '/settings/archived',
        section: 'data',
      },
      // Backup sits with the other data rows rather than three taps down under
      // the profile screen, because the moment somebody wants it is the moment
      // they are worried about losing something.
      {
        icon: 'cloud-upload-outline',
        label: t.backup.title,
        route: '/settings/backup',
        section: 'data',
      },
      { icon: 'language-outline', label: t.language, route: '/settings/language', section: 'app' },
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
    [t, tour],
  );

  // A guest tapping "new group" past their limit is sent to sign up rather than
  // into a form the server would refuse (ADR-006 addendum). A full user's guard
  // waves this through.
  const openNewGroup = (): void => {
    if (guard.blockAddGroup()) return;
    router.push('/new-group');
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

  // Settle up from Home asks which group first; these are the ones with money
  // outstanding either way, largest first.
  const [settleOpen, setSettleOpen] = useState(false);
  const settleCandidates: SettleCandidate[] = list
    .map((group) => ({
      id: group.id,
      title: groupLabel(group, summary.membersFor(group.id), viewerId),
      coverEmoji: group.cover_emoji,
      balance: summary.balanceFor(group.id),
      currency: group.default_currency,
    }))
    .filter((group) => group.balance !== 0n)
    .sort((a, b) => {
      const size = (x: bigint) => (x < 0n ? -x : x);
      const d = size(b.balance) - size(a.balance);
      return d > 0n ? 1 : d < 0n ? -1 : 0;
    });
  // How many groups each side of the balance card comes from — in the
  // headline's currency, the one those sides are totalled in.
  const inHeadline = list.filter((group) => group.default_currency === headline.currency);
  const owedGroups = inHeadline.filter((group) => summary.balanceFor(group.id) > 0n).length;
  const owingGroups = inHeadline.filter((group) => summary.balanceFor(group.id) < 0n).length;

  const monthSpent =
    summary.monthSpent.find((entry) => entry.currency === headline.currency)?.amount ?? 0n;
  const lastMonthSpent =
    summary.lastMonthSpent.find((entry) => entry.currency === headline.currency)?.amount ?? 0n;
  const openReports = () => router.push('/personal/spending');
  // "Split bill" is the receipt camera: scan it and split it item by item. A
  // fresh nonce each time so the capture screen fires the camera exactly once.
  const openSplitBill = () => router.push(`/capture?scan=${Date.now()}`);

  // "Last activity: 2 days ago" under each group, from when its ledger last
  // moved. The formatter is built once per language, not per row.
  const rtf = useMemo(
    () =>
      typeof Intl.RelativeTimeFormat === 'function'
        ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
        : undefined,
    [locale],
  );
  const lastActivityLabel = (groupId: string): string | null => {
    const at = summary.lastActivityFor(groupId);
    if (!at || !rtf) return null;
    const ago = relativeUnit(at, nowMs);
    return t.homeDash.lastActivity.replace(
      '{when}',
      ago ? rtf.format(ago.value, ago.unit) : t.homeDash.justNow,
    );
  };

  return (
    <Screen edges={[]}>
      {/* The status bar's own strip of the wash, fixed, so the clock and the
          battery stay white-on-colour once the hero has scrolled away. */}
      <Gradient
        colors={HERO_WASH}
        radius={0}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, zIndex: 2 }}
      />

      <ScrollView
        contentContainerStyle={{
          paddingBottom: clearance,
          // Fill the viewport so the no-groups empty state can centre itself in
          // whatever height is left under the hero rather than hugging it.
          flexGrow: 1,
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
        {/* The hero: a violet wash, edge to edge and up under the status bar,
            carrying the greeting. The balance card below rides up over its
            bottom edge, so the wash leaves room for it. */}
        <Gradient
          colors={HERO_WASH}
          radius={0}
          style={{
            paddingTop: insets.top + theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: HERO_OVERLAP + theme.spacing.xl,
            borderBottomLeftRadius: theme.radius.xxl,
            borderBottomRightRadius: theme.radius.xxl,
          }}
        >
          {/* Face, "Hi, {name} 👋", the time of day and a line on what the app
              is for; then the glyphs that lead somewhere: sync, activity, the
              menu. */}
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <HeroAvatar
              name={displayName}
              photoUrl={avatarUrl}
              onPress={() => router.navigate('/profile')}
              label={t.profile}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.profile}
              onPress={() => router.navigate('/profile')}
              hitSlop={8}
              style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.5 : 1 })}
            >
              <Text variant="title" tone="onBrand" numberOfLines={1}>
                {`${t.dashHero.hi.replace('{name}', displayName)} 👋`}
              </Text>
              <Text variant="body" tone="onBrand" numberOfLines={1} style={{ opacity: 0.9 }}>
                {`${t.dashHero[greetKey]}!`}
              </Text>
              <Text variant="caption" tone="onBrand" numberOfLines={1} style={{ opacity: 0.8 }}>
                {t.homeDash.greetingSub}
              </Text>
            </Pressable>
            <SyncStatusIcon onBrand />
            <HeroIconButton
              icon="notifications-outline"
              label={t.activity}
              onPress={() => router.navigate('/activity')}
            />
            <HeroIconButton
              icon="ellipsis-vertical"
              label={t.account.faceSettings}
              onPress={() => setMenuOpen(true)}
            />
          </Row>
        </Gradient>

        {/* The body on the lavender canvas. A list gutter (`lg`, 16pt), the
            phone margin iOS and Android both default to. */}
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            marginTop: -HERO_OVERLAP,
            gap: theme.spacing.lg,
            flexGrow: 1,
          }}
        >
          {/* The tour's "hero" anchor is the balance card, so the first
              coach-mark still spotlights the balance. */}
          <TourTarget id="hero">
            <HomeBalanceCard
              net={headline.net}
              owed={headline.owed}
              owing={headline.owing}
              owedGroups={owedGroups}
              owingGroups={owingGroups}
              monthSpent={monthSpent}
              lastMonthSpent={lastMonthSpent}
              currency={headline.currency}
              locale={locale}
              hidden={balanceHidden || !balanceReady}
              onToggleHide={toggleBalance}
              settling={settling}
              loading={showSkeleton || !balanceReady}
              onReports={openReports}
            />
          </TourTarget>

          <HomeQuickActions
            // The quick sheet, not the capture screen: most spends know where
            // they belong and need an amount and a place. The long press
            // raises type / scan / speak, unchanged.
            onAddExpense={() => setQuickExpenseOpen(true)}
            onAddExpenseLong={() => setQuickAddOpen(true)}
            onSplitBill={openSplitBill}
            onSettleUp={() => setSettleOpen(true)}
            onNewGroup={openNewGroup}
            gradient={HERO_WASH}
          />

          {/* A background import's progress lands here, just above the groups —
              the person tapped Import, came home, and watches it fill. */}
          <ImportProgressBanner />

          {showSkeleton ? (
            <SkeletonList rows={3} />
          ) : list.length === 0 ? (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              {/* The one screen where somebody has nothing to act on yet gets
                  the action spelled out. */}
              <EmptyState
                title={t.tabs.noGroups}
                body={t.tabs.noGroupsBody}
                action={<Button label={t.newGroup} onPress={openNewGroup} />}
                icon={
                  <Ionicons name="people-outline" size={iconSize.xxl} color={theme.color.brand} />
                }
              />
            </View>
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="heading">{t.yourGroups}</Text>
                <Pressable
                  onPress={() => router.navigate('/groups')}
                  accessibilityRole="button"
                  accessibilityLabel={t.allGroups}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 2,
                    opacity: pressed ? 0.5 : 1,
                  })}
                >
                  <Text variant="body" tone="brand" style={{ fontWeight: '700' }}>
                    {t.homeDash.seeAll.replace('{n}', String(list.length))}
                  </Text>
                  <Ionicons
                    name={directionalIcon('chevron-forward')}
                    size={iconSize.md}
                    color={theme.color.brand}
                  />
                </Pressable>
              </Row>

              {list.slice(0, GROUPS_PREVIEW).map((group) => {
                const balance = summary.balanceFor(group.id);
                // A running trip earns a live "on trip" tag; failing that, a
                // just-made group wears "New" for its first couple of days.
                const onTrip = ongoingTripIds.has(group.id);
                const isNew = nowMs - Date.parse(group.created_at) < NEW_GROUP_WINDOW_MS;
                const tag = onTrip ? t.tagOnTrip : isNew ? t.tagNew : null;
                return (
                  <GroupRow
                    key={group.id}
                    id={group.id}
                    title={groupLabel(group, summary.membersFor(group.id), viewerId)}
                    memberLabel={plural(locale, summary.memberCountFor(group.id), t.memberCount)}
                    draftLabel={
                      draftsByGroup.has(group.id)
                        ? plural(locale, draftsByGroup.get(group.id) ?? 0, t.draftCount)
                        : null
                    }
                    activityLabel={lastActivityLabel(group.id)}
                    coverEmoji={group.cover_emoji}
                    balance={balance}
                    currency={group.default_currency}
                    locale={locale}
                    statusLabel={
                      balance === 0n ? t.allSettled : balance > 0n ? t.youAreOwed : t.youOwe
                    }
                    directionLabel={
                      balance === 0n
                        ? t.homeDash.wordSettled
                        : balance > 0n
                          ? t.homeDash.wordOwed
                          : t.homeDash.wordOwe
                    }
                    pendingLabel={summary.hasPending(group.id) ? t.pendingConfirmation : null}
                    tag={tag}
                    tagTone={onTrip ? 'positive' : 'brand'}
                    // The eye shuts the whole screen's money, not just the
                    // headline — and stays shut until the saved choice has
                    // loaded, so a hidden balance never flashes in plain.
                    hidden={balanceHidden || !balanceReady}
                    // The just-imported group slides and fades into place.
                    enter={group.id === justAddedId}
                    // Its balance materialises a beat after the row does, so
                    // mask it until the ledger lands rather than show ₹0.
                    pendingBalance={group.id === justAddedId && !summary.hasLedger(group.id)}
                    onPress={() => router.push(`/group/${group.id}`)}
                    pinned={pinnedIds.has(group.id)}
                  />
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
      <SettlePickerSheet
        visible={settleOpen}
        onClose={() => setSettleOpen(false)}
        groups={settleCandidates}
      />

      {/* Signed in on a phone that holds no personal ledger — a new handset, a
          reinstall, a sign-out and back in — and asked once whether to bring the
          Drive backup back. It decides for itself whether it applies; see
          `lib/backup/restorePrompt`. Outranks the guest and tip prompts. */}
      <RestorePrompt />

      {/* Guests are nudged to secure their account as a popup — once a day,
          dismissible, held back while the tour is up. */}
      {isGuest ? (
        <GuestPopup gate={guard.gate} t={t} onAction={() => router.push('/settings/account')} />
      ) : null}

      {/* The daily tip, surfaced as a sheet on the first Home open of the day. */}
      <TipSheet t={t} />

      <QuickAddSheet
        visible={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        actions={quickAddActions}
      />

      <QuickExpenseSheet visible={quickExpenseOpen} onClose={() => setQuickExpenseOpen(false)} />
    </Screen>
  );
}

/**
 * The face at the top of the hero. With a photo it is the ordinary Avatar; with
 * none it is a person glyph inside a ringed, *transparent* circle — the hero's
 * colour shows through rather than an initials chip on a tinted disc, so it sits
 * on the wash the way the reference's placeholder does. White glyph and ring, so
 * one treatment reads on green, teal or indigo alike.
 */
function HeroAvatar({
  name,
  photoUrl,
  onPress,
  label,
}: {
  name: string;
  photoUrl?: string | null;
  onPress: () => void;
  label: string;
}) {
  const theme = useTheme();
  if (photoUrl) {
    return (
      <Avatar
        name={name}
        size={64}
        photoUrl={photoUrl}
        accessibilityLabel={label}
        onPress={onPress}
      />
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderColor: 'rgba(255, 255, 255, 0.55)',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name="person-outline" size={iconSize.xxl} color={theme.color.onBrand} />
    </Pressable>
  );
}

/** The AsyncStorage key remembering whether the balance is hidden behind the eye. */
const BALANCE_HIDDEN_KEY = 'dashboard:balanceHidden';

/**
 * The eye toggle's state, remembered across opens. Reads once on mount (so a
 * hidden balance stays hidden after a relaunch, not flashing the number first)
 * and writes on every toggle. Defaults to shown.
 */
function useBalanceHidden(): { hidden: boolean; ready: boolean; toggle: () => void } {
  const [hidden, setHidden] = useState(false);
  // `hidden` starts shown and the stored value arrives a frame or more later,
  // so without a gate the real number paints before the mask does — exactly the
  // flash the doc above promises not to do. `ready` flips once the read settles
  // (success or failure) so the caller can hold the skeleton until then.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(BALANCE_HIDDEN_KEY)
      .then((value) => {
        if (alive && value === '1') setHidden(true);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  const toggle = useCallback(() => {
    setHidden((was) => {
      const next = !was;
      void AsyncStorage.setItem(BALANCE_HIDDEN_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  }, []);
  return { hidden, ready, toggle };
}

/** A bare white glyph in the hero's top-right cluster — the sync icon's
    neighbour, the overflow menu's handle. No disc, so it reads lighter than the
    action circles below. */
function HeroIconButton({
  icon,
  label,
  onPress,
  family = 'ionicons',
}: {
  icon: string;
  label: string;
  onPress: () => void;
  /** Which glyph set `icon` names — Ionicons by default, Material for the ones
   *  Ionicons lacks (the two-people-plus "group add"). */
  family?: 'ionicons' | 'material';
}) {
  const theme = useTheme();
  const Glyph = family === 'material' ? MaterialIcons : Ionicons;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: theme.spacing.xs })}
    >
      <Glyph name={icon as never} size={iconSize.xxl} color={theme.color.onBrand} />
    </Pressable>
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

/** The day the tip sheet was last shown, so it surfaces once a day and no more. */
const TIP_SHEET_KEY = 'dashboardTips:shownOn';

/**
 * How long the tip waits once it is cleared to show. On a first run this is the
 * beat after the tour finishes before the hint lands; on any other day it is a
 * small settle so the tip does not race the dashboard in. See `usePromptSlot`.
 */
const TIP_DELAY_MS = 1400;

/**
 * The daily tip, as a bottom sheet.
 *
 * It shows itself once on the first Home open of each day — the deck rotates by
 * the day (see `useDashboardTips`), so a new move surfaces each time rather than
 * the same card sitting inline forever. A big icon over the "TIP" kicker, the
 * title and body, then the way out: a primary that walks to the feature when the
 * tip points somewhere (only the receipt scan does today), and a plain "Got it"
 * otherwise. Tapping the backdrop dismisses it too — a hint never traps.
 *
 * The show is stamped for the day the moment it opens, not on close, so a person
 * who reads it and backgrounds the app is not shown it again on the next open.
 */
function TipSheet({ t }: { t: UiStrings }) {
  const theme = useTheme();
  const { tip } = useDashboardTips(t);

  // The day the sheet was last shown, read once on mount — the same shape the
  // guest prompt's daily dismissal uses, and for the same reason: reading it in a
  // plain mount effect (not one gated on the tip loading) is what actually runs.
  // `ready` gates the first paint so the sheet never flashes before we know.
  const [shownOn, setShownOn] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(TIP_SHEET_KEY)
      .then((value) => {
        if (alive) setShownOn(value);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Wants to show, on the merits: read, unshown today, not closed, has a tip.
  const wants = ready && shownOn !== localToday() && !closed && Boolean(tip);
  // But it only actually opens once the prompt queue clears it — behind the
  // tour on a first run, and after a short delay either way (see TIP_DELAY_MS).
  const granted = usePromptSlot({
    id: 'dashboardTip',
    priority: 10,
    active: wants,
    delayMs: TIP_DELAY_MS,
  });
  const open = wants && granted;

  // Stamp the day the moment the sheet is shown — not on close — so someone who
  // reads it and backgrounds the app is not shown it again on the next open. The
  // write goes straight to storage and deliberately does not touch `shownOn`, so
  // the sheet stays up this session until the person closes it.
  const stamped = useRef(false);
  useEffect(() => {
    if (!open || stamped.current) return;
    stamped.current = true;
    void AsyncStorage.setItem(TIP_SHEET_KEY, localToday()).catch(() => {});
  }, [open]);

  const close = () => setClosed(true);
  const act = () => {
    if (tip?.route) {
      // The scan tip's route carries a constant `scan=` sentinel; swap it for a
      // fresh nonce so the capture screen fires the camera exactly once and does
      // not reopen it when Android recreates the screen on the camera's return.
      const href = tip.route.includes('scan=') ? `/capture?scan=${Date.now()}` : tip.route;
      router.push(href as never);
    }
    close();
  };

  // Presented through the shared Sheet, which mounts fresh with visible=true
  // (never the mount-false-then-toggle that failed to present on Android). Gated
  // on `tip` so an empty sheet never slides up before the day's tip is chosen.
  return (
    <Sheet
      visible={open && Boolean(tip)}
      onClose={close}
      closeLabel={t.common.close}
      style={{
        paddingHorizontal: theme.spacing.xxl,
        paddingTop: theme.spacing.xl,
        gap: theme.spacing.lg,
      }}
    >
      {tip ? (
        <>
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.buttonPrimary,
              }}
            >
              <Ionicons name={tip.icon} size={iconSize.xxl} color={theme.color.onBrand} />
            </View>
            <Text variant="micro" tone="brand" style={{ letterSpacing: 0.8 }}>
              {t.tips.label.toUpperCase()}
            </Text>
            <Text variant="title" align="center">
              {tip.title}
            </Text>
            <Text variant="body" tone="muted" align="center">
              {tip.body}
            </Text>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            {tip.route ? (
              <>
                <Button label={t.tips.action} size="lg" fullWidth onPress={act} />
                <Button
                  label={t.misc.gotIt}
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onPress={close}
                />
              </>
            ) : (
              <Button label={t.misc.gotIt} size="lg" fullWidth onPress={close} />
            )}
          </View>
        </>
      ) : null}
    </Sheet>
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

/** The hero's wash: violet running to blue, brighter than the brand's own so
 *  the white balance card riding over it reads as lifted off the colour. Every
 *  stop holds white text. */
const HERO_WASH = ['#4F55E8', '#6A5AEC', '#8469F0'] as const;

/** How far the balance card rides up over the bottom of the hero. */
const HERO_OVERLAP = 56;

/**
 * A stable tint per group, picked from its id: the same group wears the same
 * colour on every open, and neighbours rarely match.
 */
function tintFor(id: string): TintName {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return tints[Math.abs(hash) % tints.length] ?? 'lilac';
}

/**
 * A money figure with its minor units drawn lighter — "₹82,185" in full ink,
 * ".00" behind it at part strength — so the rupees are what gets read. A
 * currency with no minor units prints whole.
 */
function SplitAmount({
  amount,
  currency,
  locale,
  color,
}: {
  amount: bigint;
  currency: string;
  locale: string;
  color: string;
}) {
  const text = format(money(amount < 0n ? -amount : amount, currency as never), { locale });
  let decimal = '.';
  try {
    decimal =
      new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')
        ?.value ?? '.';
  } catch {
    // Keep the dot.
  }
  const cut = text.lastIndexOf(decimal);
  const whole = cut > 0 ? text.slice(0, cut) : text;
  const minor = cut > 0 ? text.slice(cut) : '';
  return (
    <Text variant="subheading" numberOfLines={1} style={{ color, fontWeight: '700' }}>
      {whole}
      {minor ? <Text style={{ color, fontWeight: '500', opacity: 0.6 }}>{minor}</Text> : null}
    </Text>
  );
}

/**
 * One group as its own card, washed faintly in the group's own tint — a disc
 * with the group's mark, the name with its "New" / "On trip" tag, who is in it
 * and what is waiting, when it last moved; on the right the balance in the
 * colour of its direction with that direction as a pill under it, and a
 * chevron. The whole card is the tap into the group.
 */
function GroupRow({
  id,
  title,
  memberLabel,
  draftLabel,
  activityLabel,
  coverEmoji,
  balance,
  currency,
  locale,
  statusLabel,
  directionLabel,
  pendingLabel,
  tag,
  tagTone,
  enter = false,
  pendingBalance = false,
  hidden = false,
  onPress,
  pinned = false,
}: {
  id: string;
  title: string;
  memberLabel: string;
  /** "1 draft" when this group has money caught but not yet entered, else
   *  null — the one thing on the row that is waiting on the reader. */
  draftLabel: string | null;
  /** "Last activity: 2 days ago", or null when it cannot be said. */
  activityLabel: string | null;
  coverEmoji: string | null;
  balance: bigint;
  currency: string;
  locale: string;
  /** "You are owed" — spoken, in the row's accessibility label. */
  statusLabel: string;
  /** "you owe" — the same standing, drawn in a pill under the amount. */
  directionLabel: string;
  pendingLabel: string | null;
  tag: string | null;
  tagTone: 'positive' | 'brand';
  /** The dashboard's eye is shut: show the mask in place of the amount. The
      standing stays — it is the figure that is private. */
  hidden?: boolean;
  /** True while this group's balance is still materialising (just after an
      import): the amount is masked with a skeleton instead of a wrong zero. */
  pendingBalance?: boolean;
  /** True for a row that has just arrived (a fresh import): it fades and slides
      into place on mount rather than blinking in. */
  enter?: boolean;
  onPress: () => void;
  /** Sorted to the top by `orderByPin`; carries the small pin glyph and is
      announced in the row's accessibility label. */
  pinned?: boolean;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { t } = useStrings();
  const tint = theme.tint[tintFor(id)];

  // The entrance: start dropped and clear, settle into place. Only for a row
  // flagged `enter`, and never under reduce motion. Lazy-init state, never a
  // ref read in render (the React Compiler lints that), native-driven.
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

  // A screen reader is given the label instead of the text inside the row, so
  // everything the row says on screen is said here too.
  const spoken = [
    pendingLabel ?? [memberLabel, draftLabel].filter(Boolean).join(' · '),
    statusLabel,
  ]
    .concat(activityLabel ? [activityLabel] : [])
    .join(' · ');
  const ink =
    balance === 0n
      ? theme.color.textMuted
      : balance > 0n
        ? theme.color.positive
        : theme.color.negative;
  const pill =
    balance === 0n
      ? theme.color.surfaceMuted
      : balance > 0n
        ? theme.color.positiveSoft
        : theme.color.negativeSoft;

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          pinned ? `${title}. ${t.group.pinnedBadge}. ${spoken}` : `${title}. ${spoken}`
        }
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          paddingStart: theme.spacing.md,
          paddingEnd: theme.spacing.sm,
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          overflow: 'hidden',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {/* The card's faint wash in the group's own tint. */}
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: tint.bg, opacity: 0.35 }]}
        />
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: tint.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GroupMark emoji={coverEmoji} size={26} color={tint.ink} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            {pinned ? <Ionicons name="pin" size={12} color={theme.color.textMuted} /> : null}
            <Text variant="body" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '700' }}>
              {title}
            </Text>
            {tag ? (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 1,
                  borderRadius: theme.radius.pill,
                  backgroundColor:
                    tagTone === 'positive' ? theme.color.positiveSoft : theme.color.brandSoft,
                }}
              >
                <Text
                  variant="micro"
                  tone={tagTone === 'positive' ? 'positive' : 'brand'}
                  style={{ fontWeight: '700' }}
                >
                  {tag}
                </Text>
              </View>
            ) : null}
          </Row>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {pendingLabel ?? [memberLabel, draftLabel].filter(Boolean).join('  ·  ')}
          </Text>
          {activityLabel ? (
            <Row style={{ alignItems: 'center', gap: 4 }}>
              <Ionicons name="time-outline" size={13} color={theme.color.textMuted} />
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {activityLabel}
              </Text>
            </Row>
          ) : null}
        </View>
        {pendingBalance ? (
          <Skeleton width={64} height={16} radius={6} animated={!reduceMotion} />
        ) : (
          <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs, maxWidth: '40%' }}>
            {hidden ? (
              <Text variant="subheading" tone="muted" style={{ fontWeight: '700' }}>
                {BALANCE_MASK}
              </Text>
            ) : (
              <SplitAmount amount={balance} currency={currency} locale={locale} color={ink} />
            )}
            <View
              style={{
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 2,
                borderRadius: theme.radius.pill,
                backgroundColor: pill,
              }}
            >
              <Text variant="caption" numberOfLines={1} style={{ color: ink, fontWeight: '600' }}>
                {directionLabel}
              </Text>
            </View>
          </View>
        )}
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.md}
          color={theme.color.textMuted}
        />
      </Pressable>
    </Animated.View>
  );
}
