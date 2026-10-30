import { activityLabels, resplitActivityLabel } from '@/data/activityLabels';
import { AdSlot } from '@/components/AdSlot';
import { placeSlots } from '@/lib/adPlanPure';
import { useAdPlan } from '@/lib/useAdPlan';
import { memo, useCallback, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { type Href, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';

import {
  Badge,
  Button,
  directionalIcon,
  EmptyState,
  iconSize,
  Row,
  Screen,
  Text,
  type TintName,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import {
  activityDateSpan,
  type ActivityLabels,
  activityHeadline,
  activityTarget,
  activityTimestamp,
  dayHeading,
  describeActivity,
  filterByDayRange,
  groupByDay,
  isGroupChange,
  parseMoney,
} from '@/data/activity';
import { resplitBatchId } from '@/data/recentActivity';
import { actorName, GroupType } from '@/data/types';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { GroupMark } from '@/components/GroupMark';
import { SplitMoney } from '@/components/SplitMoney';
import { GroupTypeTag, useGroupTypeTagLabels } from '@/components/GroupTypeTag';
import { useHeroStatusBar } from '@/components/ScreenHero';
import { HERO_TEXT_SHADOW } from '@/components/person/pairParts';
import {
  scrimColorsFor,
  HERO_SCRIM_LOCATIONS,
  HOME_HERO_PHOTOS,
} from '@/components/home/HomeHeroBackground';
import { useBlockedUsers } from '@/data/blocked';
import { ActivityDateFilter, type DateRange } from '@/components/ActivityDateFilter';
import { FeedSkeleton } from '@/components/Skeletons';
import { useTransitionSettled } from '@/lib/useTransitionSettled';
import { markActivitySeen } from '@/lib/activitySeen';
import {
  activityAmountStyle,
  activityCategory,
  activityTileGlyph,
  type AmountTone,
  type GlyphFamily,
} from '@/lib/activityRowPure';
import {
  groupTypeTag,
  type GroupTypeTag as GroupTypeTagValue,
  type GroupTypeTagLabels,
} from '@/lib/groupTypeTag';
import { useHomeHero } from '@/lib/useHomeHero';
import { useMarkGroupSeen } from '@/lib/useGroupUnread';
import { useGroups, useRecentActivity, useUndoResplit, type RecentActivityRow } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { usePullRefresh } from '@/lib/pullRefresh';
import { SyncStatus, useSync } from '@/sync';

// The day-grouped feed flattened for FlashList, which has no section API: a
// `header` item per day, then that day's `entry` rows. Headers scroll inline
// with their rows (not pinned — sticky headers on this long, variable-height
// feed left blank gaps and misaligned on a fast fling). `firstOfDay` drives the
// between-row hairline so no line falls between a day heading and its first entry.
//
// A row carries a fully pre-computed `RowView`, not the raw entry: the localized
// sentence, actor, group label, relative time, tint and parsed amount are all
// resolved once when the list is built (see `toRowView`), never per render. On a
// fast fling FlashList recycles a cell onto a new row constantly, so the mount
// has to be near-free — recomputing all of that per mount is what let a hard
// fling outrun the recycler into a blank screen.
type RowView = {
  undoBatchId: string | null;
  href: Href;
  /** The whole event as one sentence — the spoken (screen-reader) label. */
  label: string;
  /** The visible title, event-first so the feed is skimmable. */
  headline: string;
  who: string | null;
  groupId: string | null;
  /** The group's name, shown consistently across activity kinds. */
  groupName: string | null;
  /** The group's tag pill, same as Home's: its own tag, else its type. */
  groupTag: GroupTypeTagValue | null;
  timestamp: string;
  tintKey: TintName;
  glyph: { family: GlyphFamily; name: string };
  /** What the meta line names between the actor and the time: the expense's
   *  category, else the group's kind ("Trip"), each with its small icon. */
  tag: { family: GlyphFamily; name: string; label: string; tint: TintName | null } | null;
  money: ReturnType<typeof parseMoney>;
  /** The reader's own stake in this expense, when they are on the bill. */
  stake: RecentActivityRow['stake'];
  amountTone: AmountTone;
  amountStrike: boolean;
  archived: boolean;
  unavailable: boolean;
};

type FeedRow =
  | { kind: 'ad'; key: string; slot: number }
  | { kind: 'header'; key: string; date: string }
  | { kind: 'row'; key: string; firstOfDay: boolean; view: RowView };

type RowContext = {
  locale: string;
  t: ReturnType<typeof useStrings>['t'];
  myProfileId: string | null;
  blockedIds: ReturnType<typeof useBlockedUsers>['blockedIds'];
  rtf: Intl.RelativeTimeFormat | undefined;
  labels: ActivityLabels;
  labelForBuiltin: (id: string) => string | undefined;
  groupTagLabels: GroupTypeTagLabels;
  /** Opened from one group: the group kind is redundant on every row. */
  scoped: boolean;
};

// Resolve everything a row shows, once, at list-build time. `describeActivity`
// is called once for the spoken label; the visible title uses the lighter
// `activityHeadline`; `rtf` is the hoisted formatter, never rebuilt per row.
/**
 * The meta tag of a row in one group's own feed, where the group's kind says
 * nothing: the expense's description ("petrol"), else its category, else none.
 */
function scopedTag(
  description: string,
  category: ReturnType<typeof activityCategory>,
): RowView['tag'] {
  const text = description.trim();
  if (text) {
    return category
      ? { ...category.glyph, label: text }
      : { family: 'ion', name: 'pricetag-outline', label: text, tint: null };
  }
  return category ? { ...category.glyph, label: category.label } : null;
}

function toRowView(entry: RecentActivityRow, ctx: RowContext): RowView {
  const g = entry.group;
  const description =
    typeof entry.payload.description === 'string' ? entry.payload.description : '';
  const isExpense = entry.object_type === 'expense';
  const category = isExpense
    ? activityCategory(description, entry.category, ctx.labelForBuiltin)
    : null;
  const glyph = activityTileGlyph(
    entry.verb,
    entry.object_type,
    category,
    typeof entry.payload.field === 'string' ? entry.payload.field : null,
  );
  // The group's own cover is a mark the app draws (`GroupMark`), not text: set
  // as a raw emoji it printed the plate (🍽️), which the system font lacks, as a
  // broken box. So the meta names the category, or else the kind of group.
  const groupTag =
    g && !ctx.scoped
      ? groupTypeTag(g.type, g.event_template, ctx.groupTagLabels, g.custom_tag)
      : null;
  const amount = activityAmountStyle(entry.verb);
  const resplit = resplitActivityLabel(
    entry,
    ctx.locale,
    ctx.t.departedExpenses,
    ctx.t.misc.someone,
  );
  return {
    undoBatchId: resplitBatchId(entry),
    href: activityTarget(entry) as Href,
    label:
      resplit ??
      describeActivity(entry, ctx.myProfileId, ctx.blockedIds, ctx.t.misc.someone, ctx.labels),
    headline: resplit ?? activityHeadline(entry, ctx.labels),
    // Nobody did an auto-event, so it carries no actor — omit it rather than say
    // "Someone". A blocked or since-left actor still resolves through actorName.
    who: entry.actor
      ? actorName(entry.actor, ctx.myProfileId, ctx.blockedIds, ctx.t.misc.someone)
      : null,
    groupId: g?.id ?? null,
    groupName: g?.name?.trim() || null,
    groupTag,
    timestamp: activityTimestamp(ctx.locale, entry.created_at, undefined, ctx.rtf),
    tintKey: glyph.tint,
    glyph,
    tag: ctx.scoped
      ? scopedTag(description, category)
      : category
        ? { ...category.glyph, label: category.label }
        : null,
    money: parseMoney(entry.payload),
    stake: entry.stake,
    amountTone: amount.tone,
    amountStrike: amount.strike,
    archived: !!g?.archived_at,
    unavailable: !g,
  };
}

/** An icon from either family the feed draws with. */
function GlyphIcon({
  family,
  name,
  size,
  color,
}: {
  family: GlyphFamily;
  name: string;
  size: number;
  color: string;
}) {
  return family === 'mci' ? (
    <MaterialCommunityIcons
      name={name as keyof typeof MaterialCommunityIcons.glyphMap}
      size={size}
      color={color}
    />
  ) : (
    <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={size} color={color} />
  );
}

/**
 * One row of the virtualized activity feed — purely presentational over a
 * pre-computed `RowView`, and memoized so a recycled cell that lands on the same
 * row does no work. The render is just JSX assembly (no string-building, no
 * parsing), which is what keeps a hard fling from outrunning the recycler.
 */
const ActivityFeedRow = memo(function ActivityFeedRow({
  view,
  locale,
  t,
  theme,
  onMenu,
}: {
  view: RowView;
  locale: string;
  t: ReturnType<typeof useStrings>['t'];
  theme: ReturnType<typeof useTheme>;
  onMenu: (view: RowView) => void;
}) {
  // Each event is its own card: the glyph in a soft tile tinted by what the
  // bill was for (or by the verb, when it is not a bill), the event as a title,
  // who · what · when beneath it, and the money on the right — blue, or red and
  // struck through once deleted — with a ⋮ for where the event leads.
  const undo = useUndoResplit(view.groupId ?? '');
  const tint = theme.tint[view.tintKey];
  const amount = view.stake ?? view.money;
  const ink = view.amountTone === 'negative' ? theme.color.negative : theme.color.positive;
  const tagInk = view.tag?.tint ? theme.tint[view.tag.tint].ink : theme.color.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={view.label}
      onPress={() => router.push(view.href)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.sm,
        paddingStart: theme.spacing.sm,
        paddingEnd: 2,
        marginBottom: theme.spacing.sm,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.surface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tint.bg,
        }}
      >
        <GlyphIcon
          family={view.glyph.family}
          name={view.glyph.name}
          size={iconSize.md}
          color={tint.ink}
        />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 15, lineHeight: 20, fontWeight: '600', color: theme.color.text }}
        >
          {view.headline}
        </Text>
        {/* Who · what · when. What is the expense's category, else the kind of
            group, each with its small icon. An archived group, or one no longer
            on this device, gets a badge. */}
        <Row style={{ gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {view.who ? <MetaText>{`${view.who} ·`}</MetaText> : null}
          {view.groupName ? (
            // Name ellipsizes first; the pill never shrinks. One line at 360dp.
            <Row style={{ gap: 4, alignItems: 'center', flexShrink: 1, maxWidth: '100%' }}>
              <View style={{ flexShrink: 1 }}>
                <MetaText>{view.groupName}</MetaText>
              </View>
              {view.groupTag ? (
                <View style={{ flexShrink: 0 }}>
                  <GroupTypeTag tag={view.groupTag} />
                </View>
              ) : null}
              <MetaText>·</MetaText>
            </Row>
          ) : null}
          {view.tag ? (
            <>
              <GlyphIcon family={view.tag.family} name={view.tag.name} size={13} color={tagInk} />
              <MetaText>{`${view.tag.label} ·`}</MetaText>
            </>
          ) : null}
          <MetaText>{view.timestamp}</MetaText>
          {view.archived ? (
            <Badge label={t.misc.archivedGroup} tone="neutral" />
          ) : view.unavailable ? (
            <Badge label={t.misc.unavailableGroup} tone="neutral" />
          ) : null}
        </Row>
      </View>
      {view.undoBatchId && view.groupId ? (
        <Button
          label={t.departedExpenses.undo}
          variant="secondary"
          disabled={undo.isPending}
          onPress={() => undo.mutate({ batchId: view.undoBatchId! })}
        />
      ) : null}
      {undo.error ? <MetaText>{undo.error.message}</MetaText> : null}
      {/* An expense the reader is on shows THEIR side of it; anything else the
          total. `payload` is untyped JSON, so a bad amount renders as no
          amount, not a crashed tab. */}
      {amount ? (
        <SplitMoney
          amount={amount.amount}
          currency={amount.currency}
          locale={locale}
          color={ink}
          fontSize={15}
          strike={view.amountStrike}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.activityScreen.more}
        onPress={() => onMenu(view)}
        hitSlop={8}
        style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.5 : 1 })}
      >
        <Ionicons name="ellipsis-vertical" size={iconSize.sm} color={theme.color.textFaint} />
      </Pressable>
    </Pressable>
  );
});

/** One small word of a row's meta line. */
function MetaText({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, color: theme.color.textMuted }}>
      {children}
    </Text>
  );
}

/** The feed's filter chips: everything, bills, edits, or one kind of group. */
enum FeedKind {
  All = 'all',
  Expenses = 'expenses',
  Edits = 'edits',
  Trip = 'trip',
  Company = 'company',
}

const EDIT_VERBS = new Set(['edited', 'superseded']);

/** An edit to a bill, or to the group itself: its settings and its people. */
function isEdit(verb: string): boolean {
  return EDIT_VERBS.has(verb) || isGroupChange(verb);
}

/** Whether an entry belongs under a filter chip. */
function inKind(entry: RecentActivityRow, kind: FeedKind): boolean {
  switch (kind) {
    case FeedKind.Expenses:
      return entry.object_type === 'expense' && !isEdit(entry.verb);
    case FeedKind.Edits:
      return isEdit(entry.verb);
    case FeedKind.Trip:
      return entry.group?.type === GroupType.Trip;
    case FeedKind.Company:
      return entry.group?.type === GroupType.Company;
    case FeedKind.All:
    default:
      return true;
  }
}

/** Home's photographs share one 2.25:1 frame. */
const PHOTO_W = 1440;
const PHOTO_H = 640;
/** The band's height below the status bar, and how far the sheet rides over it. */
const HERO_BODY = 112;
const SHEET_OVERLAP = 20;

export default function ActivityScreen() {
  const [adVisible, setAdVisible] = useState(false);
  const theme = useTheme();
  const pull = usePullRefresh();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { session } = useAuth();
  const myProfileId = session?.user.id ?? null;
  const { blockedIds } = useBlockedUsers();

  // The feed is read straight from the mirror, so it is here offline and the
  // moment the screen opens; `hydrated` is the one wait — the first read of the
  // on-disk mirror at cold start, not a network call. If that read itself fails
  // (`status` goes to Error while still unhydrated), a retry re-runs it via
  // `flush`, so the screen offers a way out rather than a skeleton forever.
  const { hydrated, status, flush } = useSync();
  // The feed is built once the slide-in has finished, not during it: building
  // it walks the whole local history, and doing that on the push's frames made
  // the slide stall halfway and then jump. Until then the skeleton shows.
  const settled = useTransitionSettled();
  const feed = useRecentActivity(myProfileId, settled);
  // Opened from a group's hero, the feed is that group's alone.
  const params = useLocalSearchParams<{ group?: string }>();
  const onlyGroup = typeof params.group === 'string' && params.group ? params.group : null;
  // Looking at the whole feed reads everything in it, so the dashboard bell's
  // dot goes out — up to the newest row here or now, whichever is later, so a
  // server clock a little ahead of the phone's cannot leave it lit. Re-marked
  // as rows arrive while the screen is open. One group's slice of the feed
  // (opened from a group's hero) is not the whole of it, so it leaves the dot.
  useFocusEffect(
    useCallback(() => {
      if (onlyGroup) return;
      const newest = feed[0] ? Date.parse(String(feed[0].created_at)) || 0 : 0;
      markActivitySeen(Math.max(Date.now(), newest));
    }, [feed, onlyGroup]),
  );
  // That one group's slice does count as reading that group, though: its
  // unread dot on Home and Groups goes out, as if the group had been opened.
  useMarkGroupSeen(onlyGroup);
  const allEntries = useMemo(
    () => (onlyGroup ? feed.filter((entry) => entry.group_id === onlyGroup) : feed),
    [feed, onlyGroup],
  );
  // Whether the account has any live group at all — decides the empty-state's
  // next step. A brand-new account with nothing starts a group; an account that
  // has groups but no activity yet wants to add an expense, not make another
  // group. `materialiseGroups` already hides archived trips, so an account left
  // with only archived groups is treated as having none — start-a-group is still
  // the right nudge there.
  const groups = useGroups().data;
  const hasGroups = groups.length > 0;
  const shownGroup = onlyGroup ? groups.find((g) => g.id === onlyGroup) : undefined;

  // Filtering a long feed to a date span. The whole history is on the phone, so
  // this is a pure client-side cut — no fetch. `range` is the committed filter
  // (null = the full feed); `filterOpen` toggles the range-picker sheet.
  const [range, setRange] = useState<DateRange | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  // Which kind of event the chips have narrowed the feed to.
  const [kind, setKind] = useState<FeedKind>(FeedKind.All);
  // The row whose ⋮ is open. A stable callback, so the memoised rows keep it.
  const [menuFor, setMenuFor] = useState<RowView | null>(null);
  const openMenu = useCallback((view: RowView) => setMenuFor(view), []);

  // The feed's own start and end, in the phone's timezone. Clamps the picker so
  // a day outside the activity's span cannot be chosen. Null when the feed is
  // empty — there is then nothing to filter and no button to offer.
  const span = useMemo(() => activityDateSpan(allEntries), [allEntries]);

  // The rows actually shown: the whole feed, or the slice inside the range.
  const visibleEntries = useMemo(() => {
    const kinded =
      kind === FeedKind.All ? allEntries : allEntries.filter((entry) => inKind(entry, kind));
    return range ? filterByDayRange(kinded, range.start, range.end) : kinded;
  }, [allEntries, range, kind]);

  // One relative-time formatter for the whole feed, rebuilt only when the locale
  // changes — handed to `toRowView` so no `Intl.RelativeTimeFormat` is ever built
  // per row. Declared before the list so the build below can use it.
  const rtf = useMemo(
    () =>
      typeof Intl.RelativeTimeFormat === 'function'
        ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
        : undefined,
    [locale],
  );

  // The whole history is already on the phone (the mirror), so there is no page
  // to fetch — the list is fully known. `FlashList` virtualizes it: only the
  // rows near the viewport are mounted, and they recycle as the feed scrolls, so
  // a heavy account's memory and mount cost stay bounded no matter how far back
  // it goes. FlashList has no sections, so the day cut is flattened into `header`
  // items that scroll inline with their rows (like the group ledger's months).
  //
  // Each row's display is pre-computed here via `toRowView` so a recycled cell
  // mounts with no work. This whole pass only reruns when the data, filter or
  // locale changes — never on scroll — so the up-front cost is paid off-fling.
  const groupTagLabels = useGroupTypeTagLabels();
  const adHandle = useAdPlan('activity', {
    rowCount: visibleEntries.length,
    listKey: onlyGroup ? String(onlyGroup) : '',
    surfaceState: { sheetOpen: filterOpen },
  });
  const adPlan = adHandle.plan;
  const adSlotsKey = adPlan.slots.join(',');
  const listData = useMemo(() => {
    const ctx: RowContext = {
      locale,
      t,
      myProfileId,
      blockedIds,
      rtf,
      labels: activityLabels(locale, t.activityScreen, {
        trip: t.extras.typeTrip,
        home: t.extras.typeHome,
        couple: t.extras.typeCouple,
        event: t.extras.typeEvent,
        friends: t.extras.typeFriends,
        other: t.extras.typeOther,
      }),
      labelForBuiltin: (id) => (t.categories as Record<string, string | undefined>)[id],
      groupTagLabels,
      scoped: !!onlyGroup,
    };
    const rows: FeedRow[] = [];
    for (const section of groupByDay(visibleEntries)) {
      rows.push({
        kind: 'header',
        key: `day-${section.key}`,
        date: section.entries[0]!.created_at,
      });
      section.entries.forEach((entry, index) => {
        rows.push({
          kind: 'row',
          key: entry.id,
          firstOfDay: index === 0,
          view: toRowView(entry, ctx),
        });
      });
    }
    return placeSlots(rows, adPlan.slots, undefined, undefined, adHandle.minGap) as FeedRow[];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- adPlan.slots is the only part of the plan used
  }, [
    visibleEntries,
    locale,
    t,
    myProfileId,
    blockedIds,
    rtf,
    groupTagLabels,
    onlyGroup,
    adSlotsKey,
  ]);

  // The active range worded for the chip: one date when start and end share a
  // day, "start – end" otherwise. Formatted in the current locale.
  const showDay = (value: Date): string =>
    value.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const rangeLabel = range
    ? sameDay(range.start, range.end)
      ? showDay(range.start)
      : `${showDay(range.start)} – ${showDay(range.end)}`
    : '';

  const kinds: { value: FeedKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: FeedKind.All, label: t.activityScreen.all, icon: 'list' },
    { value: FeedKind.Expenses, label: t.activityScreen.expenses, icon: 'wallet-outline' },
    { value: FeedKind.Edits, label: t.activityScreen.edits, icon: 'create-outline' },
    // One group's own feed has no use for a group-kind chip.
    ...(onlyGroup
      ? []
      : [
          {
            value: FeedKind.Trip,
            label: t.activityScreen.trip,
            icon: 'airplane-outline' as const,
          },
        ]),
    ...(!onlyGroup && groups.some((g) => g.type === GroupType.Company)
      ? [
          {
            value: FeedKind.Company,
            label: t.extras.typeCompany,
            icon: 'business-outline' as const,
          },
        ]
      : []),
  ];

  // Home's scene, with white ink over the same top scrim at every hour.
  const hero = useHomeHero();
  useHeroStatusBar('light');
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const photoH = insets.top + HERO_BODY;
  // `cover` by hand, anchored to the bottom, as Home's hero does.
  const scale = Math.max(windowWidth / PHOTO_W, photoH / PHOTO_H);
  const heroInk = '#FFFFFF';
  const circle = (
    label: string,
    onPress: () => void,
    children: React.ReactNode,
    tinted = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tinted ? theme.color.brandSoft : 'rgba(255,255,255,0.92)',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  );

  const heroBand = (
    <View style={{ height: photoH }}>
      <Image
        source={HOME_HERO_PHOTOS[hero]}
        accessibilityIgnoresInvertColors
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          position: 'absolute',
          width: PHOTO_W * scale,
          height: PHOTO_H * scale,
          left: (windowWidth - PHOTO_W * scale) / 2,
          top: photoH - PHOTO_H * scale,
        }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={scrimColorsFor(hero)}
        locations={HERO_SCRIM_LOCATIONS}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: photoH * 0.7 }}
      />
      <Row
        style={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          alignItems: 'center',
          gap: theme.spacing.md,
        }}
      >
        {/* Activity is pushed, so it carries its own way back — mirrored with
            the writing direction, the same as `groups.tsx`'s header. */}
        {circle(
          t.common.back,
          () => router.back(),
          <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color="#1B1840" />,
        )}
        <View style={{ flex: 1 }}>
          {shownGroup ? (
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              <GroupMark emoji={shownGroup.cover_emoji} size={24} color={heroInk} />
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  fontSize: 24,
                  lineHeight: 30,
                  fontWeight: '800',
                  color: heroInk,
                  ...HERO_TEXT_SHADOW,
                }}
              >
                {shownGroup.name}
              </Text>
            </Row>
          ) : (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 24,
                lineHeight: 30,
                fontWeight: '800',
                color: heroInk,
                ...HERO_TEXT_SHADOW,
              }}
            >
              {t.activity}
            </Text>
          )}
          <Text
            numberOfLines={1}
            style={{ fontSize: 13, lineHeight: 18, color: heroInk, ...HERO_TEXT_SHADOW }}
          >
            {shownGroup ? t.activity : t.activityScreen.subtitle}
          </Text>
        </View>
        {/* A long feed is easier to read a day or a span at a time — the
            calendar opens a range picker clamped to the feed's own start and
            end. A filled glyph in the brand tint marks an active range. */}
        {span
          ? circle(
              t.activityFilter.open,
              () => setFilterOpen(true),
              <Ionicons
                name={range ? 'calendar' : 'calendar-outline'}
                size={iconSize.lg}
                color={range ? theme.color.brand : '#1B1840'}
              />,
              !!range,
            )
          : null}
      </Row>
    </View>
  );

  // The list sheet: rounded top corners riding up over the band's foot.
  const sheetStyle = {
    flex: 1,
    marginTop: -SHEET_OVERLAP,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: theme.color.bg,
    overflow: 'hidden' as const,
  };

  const header = (
    <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.lg }}>
      {/* What kind of event: everything, bills, edits, or a trip's. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.spacing.sm }}
      >
        {kinds.map((option) => {
          const active = option.value === kind;
          const ink = active ? theme.color.onBrand : theme.color.text;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => setKind(option.value)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                height: 36,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.pill,
                backgroundColor: active
                  ? theme.color.brand
                  : theme.scheme === 'dark'
                    ? theme.color.surfaceMuted
                    : '#ECEAF6',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name={option.icon} size={iconSize.sm} color={ink} />
              <Text style={{ fontSize: 14, color: ink, fontWeight: active ? '700' : '500' }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* The active range as a clearable pill: tap the body to adjust it, the ✕
          to drop back to the full feed. Visible state so a narrowed feed never
          looks like a short one. */}
      {range ? (
        <Row>
          <Row
            style={{
              alignItems: 'center',
              gap: theme.spacing.xs,
              paddingLeft: theme.spacing.md,
              paddingRight: theme.spacing.xs,
              paddingVertical: 4,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t.activityFilter.open}: ${rangeLabel}`}
              onPress={() => setFilterOpen(true)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.xs,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="calendar" size={iconSize.sm} color={theme.color.brand} />
              <Text variant="caption" style={{ color: theme.color.brand }}>
                {rangeLabel}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.activityFilter.clearFilter}
              onPress={() => setRange(null)}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="close-circle" size={iconSize.md} color={theme.color.brand} />
            </Pressable>
          </Row>
        </Row>
      ) : null}
    </View>
  );

  // The ⋮ on a row: the event's own screen, and its group.
  const menuItems: OverflowMenuItem[] = menuFor
    ? [
        { icon: 'open-outline', label: t.activityScreen.viewDetails, route: menuFor.href },
        ...(menuFor.groupId
          ? [
              {
                icon: 'people-outline' as const,
                label: t.activityScreen.openGroup,
                route: `/group/${menuFor.groupId}` as Href,
              },
            ]
          : []),
      ]
    : [];
  const menu = (
    <OverflowMenu visible={menuFor !== null} onClose={() => setMenuFor(null)} items={menuItems} />
  );

  // The states the feed can be in when there are no rows to show — mounted as
  // the list's empty component so the header, pull-to-refresh and centred layout
  // all still apply exactly as with a feed present.
  const empty =
    !hydrated || !settled ? (
      hydrated === false && status === SyncStatus.Error ? (
        // The mirror read itself failed (a corrupt or unreadable local DB). Rare,
        // but without this branch the skeleton would sit forever — so offer a
        // retry, which re-runs hydration through a flush.
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            title={t.loadError}
            body={t.loadErrorBody}
            icon={
              <Ionicons
                name="cloud-offline-outline"
                size={iconSize.xxl}
                color={theme.color.brand}
              />
            }
            action={<Button label={t.retry} variant="secondary" onPress={() => void flush()} />}
          />
        </View>
      ) : (
        // The ordinary wait: the first read of the on-disk mirror at cold start.
        // An empty feed after it lands is "nothing yet", not "failed".
        <FeedSkeleton />
      )
    ) : kind !== FeedKind.All ? (
      // A chip is narrowing the feed and nothing is of that kind — the way out
      // is back to everything.
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          title={t.activityScreen.noneForFilter}
          icon={<Ionicons name="funnel-outline" size={iconSize.xxl} color={theme.color.brand} />}
          action={
            <Button
              label={t.activityScreen.all}
              variant="secondary"
              onPress={() => setKind(FeedKind.All)}
            />
          }
        />
      </View>
    ) : range ? (
      // A range is in force and nothing fell in it — distinct from "nothing yet",
      // and the way out is to widen or clear the filter, not to start a group.
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          title={t.activityFilter.noneTitle}
          body={t.activityFilter.noneBody}
          icon={<Ionicons name="calendar-outline" size={iconSize.xxl} color={theme.color.brand} />}
          action={
            <Button
              label={t.activityFilter.clear}
              variant="secondary"
              onPress={() => setRange(null)}
            />
          }
        />
      </View>
    ) : (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          title={t.nothingYet}
          body={t.tabs.activityEmptyBody}
          icon={
            <Ionicons name="notifications-outline" size={iconSize.xxl} color={theme.color.brand} />
          }
          action={
            onlyGroup ? undefined : hasGroups ? (
              <Button label={t.addExpense} onPress={() => router.push('/capture')} />
            ) : (
              <Button label={t.newGroup} onPress={() => router.push('/new-group')} />
            )
          }
        />
      </View>
    );

  // The range picker, over the feed. Rendered only when open and only when there
  // is a span to clamp to, so it can seed the picker from real dates.
  const picker =
    filterOpen && span ? (
      <ActivityDateFilter
        earliest={span.earliest}
        latest={span.latest}
        locale={locale}
        initial={range}
        onApply={setRange}
        onClear={() => setRange(null)}
        onClose={() => setFilterOpen(false)}
      />
    ) : null;

  // With no rows, FlashList's empty slot renders inside an unbounded scroll view,
  // so a `flex: 1` centre is meaningless there — the header and the centred empty
  // state are laid out directly instead, keeping the same padding the feed uses.
  if (listData.length === 0) {
    return (
      <Screen edges={[]}>
        {heroBand}
        {/* The same bottom clearance the feed's rows get. Without it this box
            runs on underneath the tab bar, and centring inside it puts the
            artwork below the middle of the part you can actually see — the
            further down the screen, the more of the box is hidden. */}
        <View
          style={[sheetStyle, { paddingHorizontal: theme.spacing.xl, paddingBottom: clearance }]}
        >
          {header}
          {empty}
        </View>
        {picker}
        {menu}
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      {heroBand}
      {/* A feed broken into days: each event is an icon in a soft tile, the
          sentence beside it and the actor/group/time beneath. The day headings
          are what make a long feed skimmable — without them every row had to be
          read to place it in time. */}
      <View style={sheetStyle}>
        {/* The filters are a fixed sibling above the feed, so only the rows
            scroll under them. Padded to line up with the feed rows below. */}
        <View style={{ paddingHorizontal: theme.spacing.lg }}>{header}</View>
        <FlashList
          data={listData}
          // Too short for a native slot: one inline banner at the foot instead.
          ListFooterComponent={
            adPlan.footerBanner ? (
              <AdSlot
                handle={adHandle}
                format="inline_banner"
                slot={0}
                style={{ marginVertical: theme.spacing.lg }}
              />
            ) : null
          }
          onViewableItemsChanged={({ viewableItems }) =>
            setAdVisible(
              (seen) =>
                seen ||
                viewableItems.some(({ index }) => {
                  const slot = listData.findIndex((row) => row.kind === 'ad');
                  return slot >= 0 && index !== null && index >= slot - 1;
                }),
            )
          }
          // The row text is locale-formatted and the row's colours come from the
          // theme, so a language or light/dark switch has to re-run renderItem
          // even though the data array is unchanged.
          extraData={`${locale}|${theme.scheme}|${adVisible}`}
          keyExtractor={(item) => item.key}
          // Day headings and event rows are structurally different subtrees;
          // typing them lets FlashList recycle like with like.
          getItemType={(item) => item.kind}
          // Render well beyond the viewport so a fast fling never outruns
          // recycling into blank rows (default 250px clears in a frame).
          drawDistance={1500}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: clearance,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={theme.color.brand}
            />
          }
          renderItem={({ item, index }) =>
            item.kind === 'ad' ? (
              <AdSlot
                handle={adHandle}
                format="native"
                slot={item.slot}
                visible={adVisible}
                rowGap={theme.spacing.sm}
                precedingGap={theme.spacing.sm}
              />
            ) : item.kind === 'header' ? (
              <Text
                variant="caption"
                tone="muted"
                style={{
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  fontWeight: '600',
                  // First heading `lg` under the header, later days a section
                  // (`xl`) apart, and each heading `sm` above its rows.
                  marginTop: index === 0 ? theme.spacing.md : theme.spacing.lg,
                  marginBottom: 6,
                }}
              >
                {dayHeading(locale, item.date)}
              </Text>
            ) : (
              // Each event is its own card; the card carries its own spacing.
              <ActivityFeedRow
                view={item.view}
                locale={locale}
                t={t}
                theme={theme}
                onMenu={openMenu}
              />
            )
          }
        />
      </View>
      {picker}
      {menu}
    </Screen>
  );
}
