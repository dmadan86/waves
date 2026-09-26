import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { balanceDeckSlides, dayNumber, type BalanceSlide, type GuestGate } from '@waves/core';
import {
  Avatar,
  Button,
  directionalIcon,
  EmptyState,
  Gradient,
  iconSize,
  MoneyText,
  Popup,
  Row,
  Screen,
  Sheet,
  Skeleton,
  Text,
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
import { HeroDots } from '@/components/HeroDots';
import { SkeletonList } from '@/components/Skeletons';
import { useImportedGroupId } from '@/lib/importProgress';
import { useReducedMotion } from '@/lib/reducedMotion';
import { THEME_HIDDEN } from '@/lib/theme';
import { useDefaultCurrency } from '@/lib/currency';
import { QuickAddSheet, useQuickAddActions } from '@/components/QuickAddSheet';
import { QuickExpenseSheet } from '@/components/QuickExpenseSheet';
import { GroupAddIcon } from '@/components/GroupAddIcon';
import { HeroActionCircle, HeroPillButton } from '@/components/ScreenHero';
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
  const { width } = useWindowDimensions();
  // The eye toggle: hide the money on a shared screen, remembered across opens.
  const { hidden: balanceHidden, ready: balanceReady, toggle: toggleBalance } = useBalanceHidden();
  // The carousel's live scroll offset, owned here so the hero background and the
  // balance deck share one value: the background crossfades between the slide
  // colours (SLIDE_STYLE) exactly as the deck moves. Lazy-init, never
  // re-read through `.current` in render (the ref lint the compiler enforces).
  const [heroScrollX] = useState(() => new Animated.Value(0));
  // Each slide fills the hero's inner width; a slide's snap point is that plus
  // the gap. Computed here so the same numbers drive the deck's layout and the
  // background's colour interpolation — one source, so they can never drift.
  const heroInner = width - theme.spacing.xl * 2;
  const heroGap = theme.spacing.md;
  const heroSnap = heroInner + heroGap;
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

  // Which figures the balance deck is worth swiping through, decided from the
  // headline totals in @waves/core. Two slides for money that runs one way,
  // three when it runs both — a gross slide appears only where the net is
  // hiding a side, so no two slides ever carry the same number under two names.
  // The screen and the deck read the same answer: the colour layers, the
  // watermarks and the dot pager all count this one list.
  const deck = balanceDeckSlides(headline);
  // The ink the hero's solid pill draws its label in: the resting slide's wash,
  // which is the colour the card wears on load and the one the deck opens on.
  // Not the *live* slide — the pill sits still while the wash crossfades, and
  // the scroll value those layers interpolate is native-driven, so a colour that
  // chased the swipe would have to be read back on the JS side of a value that
  // no longer reports there. Every stop in SLIDE_STYLE clears AA on white, so
  // the pill is legible whichever slide is under it either way.
  const heroInk = SLIDE_STYLE[deck[0] ?? 'net'].gradient;
  // What the two hero pills add to the shared `HeroPillButton`, and why.
  //
  // The height floor is not decoration: each pill is wrapped in the tour's
  // anchor View, which measures to the pill exactly, and a touch target reaching
  // outside its own parent is never offered the touch on Android — so `hitSlop`
  // cannot buy back the last few points here and the box itself has to clear the
  // 44pt minimum. The pill's own padding around a 22pt line leaves it at 38.
  //
  // The narrower side padding is a truncation guard. Each pill is a fixed half of
  // the row, so its padding is straight off the label's budget rather than added
  // around it; at the pill's usual `lg` a two-word label runs out of room on a
  // 320pt screen. Centred in a fixed width, the difference is invisible.
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

  return (
    <Screen edges={[]}>
      {/* The hero is a fixed header — it stays put while only the body below it
          scrolls, matching Friends. */}
      {/* The hero: one saturated green card that runs edge to edge and up under
            the status bar — the reference's signature "account panel". It carries
            the whole top of the screen now: the greeting and face, the swipeable
            balance, and the add actions. Everything below it is the plain white
            body. Wrapped as the tour's "hero" anchor so the first coach-mark still
            spotlights the balance. */}
      <TourTarget id="hero">
        <View
          style={{
            paddingTop: insets.top + theme.spacing.md,
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: theme.spacing.md,
            borderBottomLeftRadius: theme.radius.xxl,
            borderBottomRightRadius: theme.radius.xxl,
            // Was xl. The hero holds three stacked things and paid 20 twice for
            // the privilege; at lg it still breathes and the groups — the reason
            // the screen exists — start higher up the glass.
            gap: theme.spacing.lg,
            overflow: 'hidden',
          }}
        >
          {/* One gradient layer per slide, stacked and clipped to the hero's
                rounded corner. Each fades in as its slide reaches centre and out
                as you leave it (opacity peaks at that slide's snap point, zero at
                its neighbours), so the hero crossfades colour in lock-step with
                the swipe. Native-driven opacity off the shared scroll value —
                smooth at 60fps and free at rest. The first layer sits opaque
                behind everything as the base while the balance loads. */}
          {deck.map((slide, index) => (
            <Animated.View
              key={slide}
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                index === 0
                  ? null
                  : {
                      opacity: heroScrollX.interpolate({
                        inputRange: [
                          (index - 1) * heroSnap,
                          index * heroSnap,
                          (index + 1) * heroSnap,
                        ],
                        outputRange: [0, 1, 0],
                        extrapolate: 'clamp',
                      }),
                    },
              ]}
            >
              <Gradient colors={SLIDE_STYLE[slide].gradient} radius={0} style={{ flex: 1 }} />
            </Animated.View>
          ))}

          {/* The corner watermark — a faint glyph per slide that crossfades
                as you swipe, off the same scroll value as the colour. */}
          <HeroBackdrop slides={deck} scrollX={heroScrollX} snap={heroSnap} />

          {/* Greeting row: face + "Hi, {name}" over the time of day, then the
                white controls the reference tucks top-right — sync, a shortcut to
                start a group, and the overflow menu. */}
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
              <Text variant="heading" tone="onBrand" numberOfLines={1}>
                {t.dashHero.hi.replace('{name}', displayName)}
              </Text>
              <Text variant="caption" tone="onBrand" style={{ opacity: 0.85 }}>
                {t.dashHero[greetKey]}
              </Text>
            </Pressable>
            <SyncStatusIcon onBrand />
            {/* Activity sits up here with the other glyphs that lead somewhere
                  and change nothing: sync, the menu, the face. It is a shortcut
                  to a feed you read — the grid below is for the things that
                  create something, and this was the odd one out among them. */}
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

          {/* The swipeable balance — net, then owed, then this month — riding
                on the hero's colour rather than in its own card (ADR-004: no total
                across currencies, so each is its own slide). Its scroll drives the
                background crossfade above. A placeholder stands in only while
                there is genuinely no figure to show; a figure that is merely
                unconfirmed is shown at full strength, with a small spinner beside
                its label. */}
          {showSkeleton || !balanceReady ? (
            <HeroBalanceSkeleton />
          ) : (
            <HeroBalance
              slides={deck}
              primary={headline}
              monthSpent={summary.monthSpent}
              locale={locale}
              t={t}
              hidden={balanceHidden}
              onToggleHide={toggleBalance}
              scrollX={heroScrollX}
              cardWidth={heroInner}
              gap={heroGap}
              snap={heroSnap}
              settling={settling}
            />
          )}

          {/* The two things you start from Home, on the panel and wearing the
                group hero's pair of faces: a solid white pill for the expense —
                the one unmistakable thing to press — and the same pill hollowed
                out for the group beside it.

                Outside the paging deck on purpose. Inside it they would be a set
                of buttons per slide, scrolling off with the figure and arriving
                back from the other side, and the tour's anchors would measure
                whichever copy happened to be on screen.

                Equal halves rather than the group hero's pill-and-discs, because
                both actions carry a word and there is no third one to make room
                for; the halves swap ends under RTL on their own. */}
          {/* The group hero's own row, not a variant of it: one pill that hugs
              its label, and what is left pushed to the shoulder as a disc. The
              pill was a forced half-width here, which is what made "Add
              expense" collide with its own glyph and need shortening; letting
              it size to its words fixes the fit and matches the screen this
              was taken from. */}
          {/* The pager rides in the row with the buttons, in the gap the two of
              them leave between the pill and the disc. On a line of its own it
              was a third band of hero to get past, and centred there it lined
              up with nothing; here the row has one horizontal rhythm and the
              dots sit in the middle of it. */}
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <TourTarget id="addExpense">
              <HeroPillButton
                icon="add"
                // The plus is doing the verb's work, so the pill carries the
                // noun. Spoken it is still the whole action: "Expense" heard
                // on its own could be a heading.
                label={t.expenseShort}
                spokenLabel={t.addExpense}
                gradient={heroInk}
                // The quick sheet, not the capture screen. Most spends know
                // exactly where they belong and need an amount and a place,
                // which is what this asks for; the capture screen is still one
                // tap below, through "More details", carrying whatever has been
                // typed. The long press raises type/scan/speak, unchanged.
                onPress={() => setQuickExpenseOpen(true)}
                onLongPress={() => setQuickAddOpen(true)}
              />
            </TourTarget>
            {/* Takes the slack, so the disc still sits on the shoulder and the
                dots centre in what is left. */}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <HeroDots count={deck.length} scrollX={heroScrollX} snap={heroSnap} />
            </View>

            <Row>
              <TourTarget id="addGroup">
                <HeroActionCircle
                  // The mark carries its own plus, so there is no badge on it.
                  // Smaller than an Ionicon would be in the same disc: this
                  // mark is three figures and a plus where a glyph is one
                  // shape, and at icon size that detail needs the air around
                  // it more than it needs the extra points. The disc keeps its
                  // own size — it is the touch target.
                  glyph={<GroupAddIcon size={16} color={heroInk[0] ?? theme.color.brand} />}
                  // White like the pill beside it: the dim disc all but
                  // vanished on the lighter stops of the wash.
                  solid
                  ink={heroInk[0]}
                  label={t.newGroup}
                  onPress={openNewGroup}
                />
              </TourTarget>
            </Row>
          </Row>
        </View>
      </TourTarget>

      <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />

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
        {/* The white body beneath the hero: the groups list. A list gutter
            (`lg`, 16pt) rather than the page gutter (`xl`): 16pt is the phone
            margin iOS and Android both default to, and on a 390pt iPhone the
            extra 8pt of a 20pt gutter came straight out of the group's name,
            which was cutting off short. Friends lists people the same way.
            `lg` above it, the gap every screen opens under its header. */}
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.lg,
            // Heading → its card. The import banner, when it shows, adds its
            // own margin so it still sits a full section gap (xl) above.
            gap: theme.spacing.sm,
            flexGrow: 1,
          }}
        >
          {/* A background import's progress lands here, just above the groups —
              the person tapped Import, came home, and watches it fill. */}
          <ImportProgressBanner />

          {showSkeleton ? (
            <SkeletonList rows={3} />
          ) : list.length === 0 ? (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              {/* The one screen where somebody has nothing to act on yet gets
                  the action spelled out, rather than leaving them to find the
                  small icon up in the hero's header cluster. */}
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
            <>
              {/* The heading carries the door to the full list: the card below is
                  a capped preview, "All groups" opens the whole roster. */}
              <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="subheading">{t.yourGroups}</Text>
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
                  <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                    {t.allGroups}
                  </Text>
                  <Ionicons
                    name={directionalIcon('chevron-forward')}
                    size={iconSize.md}
                    color={theme.color.brand}
                  />
                </Pressable>
              </Row>
              {/* The groups as one clean list on a single card — an emoji chip, the
                  name and its standing, the balance to the right — the banking-app
                  "recent" list the reference leans on, hairline-divided. Capped to
                  a preview; the full list lives behind "All groups". */}
              <View
                style={{
                  backgroundColor: theme.color.surface,
                  borderRadius: theme.radius.lg,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  overflow: 'hidden',
                }}
              >
                {list.slice(0, GROUPS_PREVIEW).map((group, index) => {
                  const members = summary.membersFor(group.id);
                  const balance = summary.balanceFor(group.id);
                  // A running trip earns a live "on trip" tag; failing that, a
                  // just-made group wears "New" for its first couple of days.
                  const onTrip = ongoingTripIds.has(group.id);
                  const isNew = nowMs - Date.parse(group.created_at) < NEW_GROUP_WINDOW_MS;
                  const tag = onTrip ? t.tagOnTrip : isNew ? t.tagNew : null;
                  return (
                    <GroupRow
                      key={group.id}
                      title={groupLabel(group, members, viewerId)}
                      memberLabel={plural(locale, summary.memberCountFor(group.id), t.memberCount)}
                      draftLabel={
                        draftsByGroup.has(group.id)
                          ? plural(locale, draftsByGroup.get(group.id) ?? 0, t.draftCount)
                          : null
                      }
                      coverEmoji={group.cover_emoji}
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
                      tagTone={onTrip ? 'positive' : 'brand'}
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
                      // No long-press pin here: a hold on Home's list pinned by
                      // accident. Pinning lives on the Groups list and the
                      // group's own ••• menu; a pinned group still sorts first
                      // and wears its glyph.
                      pinned={pinnedIds.has(group.id)}
                    />
                  );
                })}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* Signed in on a phone that holds no personal ledger — a new handset, a
          reinstall, a sign-out and back in — and asked once whether to bring the
          Drive backup back. It decides for itself whether it applies, and stays
          silent for everybody whose records are already here; see
          `lib/backup/restorePrompt` for every condition and why each one is
          there. Outranks the guest and tip prompts in the queue. */}
      <RestorePrompt />

      {/* Guests are nudged to secure their account as an animated popup rather
          than an inline banner — once a day, dismissible. Held back while the
          tour is up so the two do not stack on a guest's first run. */}
      {isGuest ? (
        <GuestPopup gate={guard.gate} t={t} onAction={() => router.push('/settings/account')} />
      ) : null}

      {/* The daily tip, surfaced as a sheet on the first Home open of the day —
          one useful, Waves-specific move at a time, then out of the way until
          tomorrow. Replaces the inline card so a hint asks for a beat of
          attention rather than sitting as furniture nobody reads. */}
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
        size={44}
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
        width: 44,
        height: 44,
        borderRadius: 22,
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

/** What stands in for a figure while the eye is shut. One string, because the
    hero and the group rows have to mask identically or the mask reads as a
    rendering fault rather than a choice. */
const BALANCE_MASK = '••••••';

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

/** One currency's standing: the net, and the two sides that make it up. */
type CurrencyTotal = { currency: string; net: bigint; owed: bigint; owing: bigint };

/** Today as `YYYY-MM-DD` in a given timezone, never the server's. */
function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * How each balance slide dresses the hero: one saturated wash so the whole card
 * takes a colour of its own as you swipe — green for where you stand, teal for
 * what is owed to you, copper for what you owe, indigo for what you've spent —
 * and one watermark glyph, a faint oversized outline riding the corner. Each
 * gradient is two diagonal stops, dark enough that the white ink clears AA on
 * either stop in both themes (like a bank card, the hero keeps its colour
 * whichever theme is on). Money's own red/green still lives on the ledger rows
 * below, where owe-vs-owed has to be told apart at a glance.
 *
 * Keyed by slide rather than positional, because the deck itself is decided per
 * person (`balanceDeckSlides`) — a two-slide deck must paint its month slide
 * indigo, not inherit whatever colour sat second in a fixed list.
 */
const SLIDE_STYLE: Record<
  BalanceSlide,
  { readonly gradient: readonly [string, string]; readonly icon: keyof typeof Ionicons.glyphMap }
> = {
  net: { gradient: ['#1F6B49', '#0C3A27'], icon: 'wallet-outline' },
  owed: { gradient: ['#12667A', '#06323D'], icon: 'trending-up-outline' },
  owing: { gradient: ['#8A4B12', '#40220A'], icon: 'trending-down-outline' },
  month: { gradient: ['#463F86', '#221C46'], icon: 'calendar-outline' },
};

/**
 * The hero balance's one line, in one place. `HeroBalanceSkeleton` builds
 * itself to exactly this height so the real figure settles into the
 * placeholder's space instead of shoving the buttons and the group list down —
 * which only holds if both sites read the same numbers, hence the constants.
 */
// The `title` type step (tokens.ts), which is what a group's hero uses for its
// own balance. Home used to be four points larger, so the same money read as two
// different orders of importance on two screens a tap apart; the numbers now
// match, and the hero gives back the height.
const HERO_AMOUNT_SIZE = 24;
const HERO_AMOUNT_LINE = 30;
// The tag beside the figure: heading over currency code, together exactly the
// figure's own line, so a slide is one line tall and the skeleton can match it.
const HERO_TAG_HEADING_LINE = 16;
const HERO_TAG_CODE_LINE = HERO_AMOUNT_LINE - HERO_TAG_HEADING_LINE;

const HERO_AMOUNT_STYLE = {
  fontSize: HERO_AMOUNT_SIZE,
  lineHeight: HERO_AMOUNT_LINE,
  fontWeight: '700',
} as const;

/**
 * The swipeable balance inside the hero: a few views of where you stand, one per
 * swipe, riding transparent on the hero's colour — net first (the number you see
 * on load), then whichever gross side the net is hiding, then what you have spent
 * this month. All in your primary currency, because a total across currencies is
 * a number that does not exist (ADR-004). A dot pager beneath is the "swipe me"
 * signal; every slide is the same shape, so the block never jumps as you move
 * between them.
 *
 * Which slides those are is `balanceDeckSlides`' call, made once by the screen
 * and passed down — so the deck, the colour washes and the pager cannot disagree
 * about what is in the carousel.
 *
 * The scroll offset (`scrollX`) and the slide geometry (`cardWidth`/`gap`/`snap`)
 * are owned by the screen and passed in, so the same value that lays the deck out
 * also drives the hero's colour crossfade — the two can never fall out of step.
 */
function HeroBalance({
  slides,
  primary,
  monthSpent,
  locale,
  t,
  hidden,
  onToggleHide,
  scrollX,
  cardWidth,
  gap,
  snap,
  settling,
}: {
  /** The deck, in swipe order — the screen's `balanceDeckSlides(primary)`. */
  slides: readonly BalanceSlide[];
  primary: CurrencyTotal;
  /** My share of this month's spend, per currency (from useHomeSummary). */
  monthSpent: readonly { currency: string; amount: bigint }[];
  locale: string;
  t: UiStrings;
  /** The eye toggle — masks every slide's figure while on. */
  hidden: boolean;
  onToggleHide: () => void;
  /** Shared scroll offset — the screen also reads it to crossfade the hero. */
  scrollX: Animated.Value;
  /** One slide's width, the gap between slides, and the snap step (width + gap). */
  cardWidth: number;
  gap: number;
  snap: number;
  /** The figure is the local one and a fresher answer is on its way. */
  settling: boolean;
}) {
  // Every figure is in the primary currency, which is the one the headline is
  // already in (no total across currencies, ADR-004).
  const monthAmount = monthSpent.find((entry) => entry.currency === primary.currency)?.amount ?? 0n;
  // The net slide is the only one whose sign is information, so it shows that
  // sign on the figure itself — a signed headline number is what gets read at a
  // glance, where an 11pt caption does not. The heading still names the verdict
  // in words (a Title-case phrase matching the other slides' headings); the two
  // agree, and either one alone would answer "which way do I stand".
  const netDirection =
    primary.net === 0n ? t.allSettled : primary.net > 0n ? t.dashHero.netOwed : t.dashHero.netOwe;

  // What one slide says. The gross pair name their whole side — "Receivables",
  // "Payables" — against the net's "Net receivable": the labels have to say why
  // two figures differ, because the deck only ever shows them together when
  // they do.
  const metricFor = (
    slide: BalanceSlide,
  ): { heading: string; amount: bigint; showSign?: boolean } => {
    switch (slide) {
      case 'net':
        // Square is square: a "+₹0" would be a direction where there is none.
        return { heading: netDirection, amount: primary.net, showSign: primary.net !== 0n };
      case 'owed':
        return { heading: t.dashHero.owedToYou, amount: primary.owed };
      case 'owing':
        return { heading: t.dashHero.owedByYou, amount: primary.owing };
      case 'month':
        return { heading: t.dashHero.monthSpent, amount: monthAmount };
    }
  };

  // Each slide fills the hero's inner width (`cardWidth`), snapping one-to-one.
  // No peek of the next slide: they are transparent on the hero's colour, so a
  // peek would show the next slide's floating text with no card edge to read it
  // as "another card". The dot pager carries the "swipe me" signal instead.
  const rangeFor = (index: number): number[] => [
    (index - 1) * snap,
    index * snap,
    (index + 1) * snap,
  ];

  return (
    <Animated.ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={snap}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      scrollEventThrottle={16}
      contentContainerStyle={{ gap }}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
      })}
    >
      {slides.map((slide, index) => (
        <Animated.View
          key={slide}
          style={{
            width: cardWidth,
            // The centred slide sits at full size; the one being dragged in
            // grows and brightens into focus as it reaches centre. Transform +
            // opacity only, both native-driven.
            opacity: scrollX.interpolate({
              inputRange: rangeFor(index),
              outputRange: [0.75, 1, 0.75],
              extrapolate: 'clamp',
            }),
            transform: [
              {
                scale: scrollX.interpolate({
                  inputRange: rangeFor(index),
                  outputRange: [0.94, 1, 0.94],
                  extrapolate: 'clamp',
                }),
              },
            ],
          }}
        >
          <MetricSlide
            {...metricFor(slide)}
            currency={primary.currency}
            locale={locale}
            hidden={hidden}
            onToggleHide={onToggleHide}
            settling={settling}
          />
        </Animated.View>
      ))}
    </Animated.ScrollView>
  );
}

/**
 * The balance area while it loads — translucent-white bars on the green in the
 * shape of a `MetricSlide`: the figure, then the two-line tag beside it.
 *
 * The whole point is that the swap-in is a settle, not a jump, so the skeleton
 * is exactly one slide tall — `HERO_AMOUNT_LINE`, the line both the figure and
 * the tag are pinned to — and the number lands in place instead of shoving the
 * Add-expense button and the group list down. A gentle pulse reads as
 * "loading" rather than a dead placeholder. Plain `Skeleton` is themed for
 * light surfaces and would vanish on the green, so these are hand-drawn washes.
 */
function HeroBalanceSkeleton() {
  const theme = useTheme();
  // A slow breathe so the bars read as loading. Lazy-init state, never through a
  // ref in render (the React Compiler lints that), native-driven opacity.
  const [pulse] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const bar = (width: number, height: number) => (
    <View
      style={{ width, height, borderRadius: height / 2, backgroundColor: 'rgba(255,255,255,0.28)' }}
    />
  );
  return (
    <Animated.View
      style={{
        height: HERO_AMOUNT_LINE,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        opacity: pulse,
      }}
    >
      {bar(150, 24)}
      <View style={{ gap: 5 }}>
        {bar(84, 10)}
        {bar(34, 8)}
      </View>
    </Animated.View>
  );
}

/**
 * The hero's corner decoration: one faint watermark glyph per balance slide,
 * bled off the bottom-right, that crossfades as the carousel navigates. Each
 * layer peaks in opacity at its own slide's snap point and is zero at its
 * neighbours — the exact interpolation the colour layers use — off the same
 * shared `scrollX`, so the mark swaps in lock-step with the colour and the
 * swipe. Native-driven opacity: smooth at 60fps, free at rest. The hero clips
 * it to the rounded corner (`overflow: 'hidden'`) and `pointerEvents none` so
 * it never eats a tap; white at low alpha reads the same on green/teal/indigo.
 */
function HeroBackdrop({
  slides,
  scrollX,
  snap,
}: {
  slides: readonly BalanceSlide[];
  scrollX: Animated.Value;
  snap: number;
}) {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {slides.map((slide, index) => (
        <Animated.View
          key={slide}
          style={{
            position: 'absolute',
            right: -44,
            bottom: -52,
            opacity: scrollX.interpolate({
              inputRange: [(index - 1) * snap, index * snap, (index + 1) * snap],
              outputRange: [0, 0.16, 0],
              extrapolate: 'clamp',
            }),
          }}
        >
          <Ionicons name={SLIDE_STYLE[slide].icon} size={208} color={theme.color.onBrand} />
        </Animated.View>
      ))}
    </View>
  );
}

/**
 * One balance slide, riding transparent on the hero's green, in a single line:
 * the figure first and big, then what it is as a small two-line tag — the
 * heading over the currency code — then the eye.
 *
 * It used to be two lines, "Net receivable · INR 👁" over the figure, and the
 * label line cost a row of the hero's height to say what the figure's own
 * symbol already half said. Set beside the figure the tag is no taller than
 * the digits, so the slide is one line tall; the code stays because a "$" does
 * not say which dollars. The figure leads because it is what gets read, the
 * way a bank card leads with the balance. A very large figure shrinks a little
 * to keep the line rather than wrapping under its tag.
 *
 * White ink throughout, so it reads the same in light and dark like a bank
 * card. The eye masks the figure to dots; the toggle sits on every slide (it is
 * the same control repeated as you swipe), so the eye is always to hand.
 */
function MetricSlide({
  heading,
  amount,
  currency,
  locale,
  hidden,
  onToggleHide,
  settling,
  showSign = false,
}: {
  /** What the figure is — "Net receivable", "This month". */
  heading: string;
  amount: bigint;
  currency: string;
  locale: string;
  hidden: boolean;
  onToggleHide: () => void;
  /** Print the amount's own sign in front of it. Only the net slide sets this:
   *  it is the one figure whose direction is information, and a big number is
   *  what gets read at a glance — not the tag beside it. The other two are
   *  magnitudes (what you are owed, what you spent) where a `+` would be noise. */
  showSign?: boolean;
  /** Shown with a small spinner beside the currency: this figure is the local
   *  one and this session's first sync has not confirmed it yet. */
  settling?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Row style={{ height: HERO_AMOUNT_LINE, alignItems: 'center', gap: theme.spacing.md }}>
      <View style={{ flexShrink: 1 }}>
        {hidden ? (
          <Text tone="onBrand" style={HERO_AMOUNT_STYLE} numberOfLines={1}>
            {BALANCE_MASK}
          </Text>
        ) : (
          <MoneyText
            amount={amount}
            currency={currency as never}
            locale={locale}
            tone="onBrand"
            showSign={showSign}
            style={HERO_AMOUNT_STYLE}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          />
        )}
      </View>
      {/* The tag: as tall as the figure, so it costs no line of its own. */}
      <View style={{ flexShrink: 1, minWidth: 64 }}>
        <Text
          variant="caption"
          tone="onBrand"
          numberOfLines={1}
          style={{ fontWeight: '600', lineHeight: HERO_TAG_HEADING_LINE }}
        >
          {heading}
        </Text>
        <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          <Text
            variant="micro"
            tone="onBrand"
            numberOfLines={1}
            style={{ opacity: 0.7, letterSpacing: 0.8, lineHeight: HERO_TAG_CODE_LINE }}
          >
            {currency}
          </Text>
          {settling ? <ActivityIndicator size="small" color={theme.color.onBrand} /> : null}
        </Row>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hidden ? t.dashHero.showBalance : t.dashHero.hideBalance}
        onPress={onToggleHide}
        hitSlop={10}
        style={({ pressed }) => ({ marginStart: 'auto', opacity: pressed ? 0.5 : 0.85 })}
      >
        <Ionicons
          name={hidden ? 'eye-off-outline' : 'eye-outline'}
          size={iconSize.md}
          color={theme.color.onBrand}
        />
      </Pressable>
    </Row>
  );
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
  balance,
  currency,
  locale,
  statusLabel,
  directionLabel,
  pendingLabel,
  tag,
  tagTone,
  divider,
  enter = false,
  pendingBalance = false,
  hidden = false,
  onPress,
  pinned = false,
}: {
  title: string;
  memberLabel: string;
  /** "2 drafts" when this group has money caught but not yet entered, else
   *  null. Worth a place on the row because a draft is the one thing here that
   *  is waiting on the reader. */
  draftLabel: string | null;
  coverEmoji: string | null;
  balance: bigint;
  currency: string;
  locale: string;
  /** "You are owed" — spoken, in the row's accessibility label. */
  statusLabel: string;
  /** "owed" — the same standing, drawn small under the amount it describes. */
  directionLabel: string;
  pendingLabel: string | null;
  tag: string | null;
  tagTone: 'positive' | 'brand';
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
  /** Sorted to the top by `orderByPin`; carries the small pin glyph and is
      announced in the row's accessibility label — a glyph alone says nothing
      to a screen reader. */
  pinned?: boolean;
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
  const detail = pendingLabel ?? [memberLabel, draftLabel].filter(Boolean).join(' · ');
  const spoken = pendingLabel ?? [memberLabel, draftLabel, statusLabel].filter(Boolean).join(' · ');

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        // Pinned is spoken, not just drawn: a screen reader never sees the
        // glyph below, so the state has to be in the label itself.
        accessibilityLabel={
          pinned ? `${title}. ${t.group.pinnedBadge}. ${spoken}` : `${title}. ${spoken}`
        }
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
          borderTopWidth: divider ? 1 : 0,
          borderTopColor: theme.color.border,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.color.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GroupMark emoji={coverEmoji} size={22} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            {pinned ? <Ionicons name="pin" size={12} color={theme.color.textMuted} /> : null}
            <Text variant="body" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }}>
              {title}
            </Text>
            {tag ? (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: 6,
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
          {/* Words only. A stack of faces sat here for a while, on the theory
              that you recognise a group by who is in it; on the row it read as
              clutter beside a line that already says how many and where you
              stand. */}
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {detail}
          </Text>
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
