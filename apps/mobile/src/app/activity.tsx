import { memo, useCallback, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { guessCategory, resolveCategory } from '@waves/core';
import { FlashList } from '@shopify/flash-list';

import {
  Badge,
  Button,
  directionalIcon,
  EmptyState,
  IconButton,
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
  activityHeadline,
  activityTarget,
  activityTimestamp,
  dayHeading,
  describeActivity,
  filterByDayRange,
  groupByDay,
  parseMoney,
  verbIcon,
  verbTint,
} from '@/data/activity';
import { actorName, GroupType } from '@/data/types';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { SplitMoney } from '@/components/SplitMoney';
import { useBlockedUsers } from '@/data/blocked';
import { ActivityDateFilter, type DateRange } from '@/components/ActivityDateFilter';
import { FeedSkeleton } from '@/components/Skeletons';
import { useTransitionSettled } from '@/lib/useTransitionSettled';
import { markActivitySeen } from '@/lib/activitySeen';
import { useGroups, useRecentActivity, type RecentActivityRow } from '@/data/hooks';
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
  href: Href;
  /** The whole event as one sentence — the spoken (screen-reader) label. */
  label: string;
  /** The visible title, event-first so the feed is skimmable. */
  headline: string;
  who: string | null;
  groupLabel: string | null;
  /** The group as the subtitle names it: its mark, or its name without one. */
  groupShort: string | null;
  groupId: string | null;
  timestamp: string;
  tintKey: TintName;
  icon: ReturnType<typeof verbIcon>;
  money: ReturnType<typeof parseMoney>;
  /** The reader's own stake in this expense, when they are on the bill —
   *  coloured by direction, the way the ledger and Friends show money. */
  stake: RecentActivityRow['stake'];
  archived: boolean;
  unavailable: boolean;
};

type FeedRow =
  | { kind: 'header'; key: string; date: string }
  | { kind: 'row'; key: string; firstOfDay: boolean; view: RowView };

type RowContext = {
  locale: string;
  t: ReturnType<typeof useStrings>['t'];
  myProfileId: string | null;
  blockedIds: ReturnType<typeof useBlockedUsers>['blockedIds'];
  rtf: Intl.RelativeTimeFormat | undefined;
};

// Resolve everything a row shows, once, at list-build time. `describeActivity`
// is called once for the spoken label; the visible title uses the lighter
// `activityHeadline`; `rtf` is the hoisted formatter, never rebuilt per row.
function toRowView(entry: RecentActivityRow, ctx: RowContext): RowView {
  const g = entry.group;
  const glyph = rowGlyph(entry);
  return {
    href: activityTarget(entry) as Href,
    label: describeActivity(entry, ctx.myProfileId, ctx.blockedIds, ctx.t.misc.someone),
    headline: activityHeadline(entry),
    // Nobody did an auto-event, so it carries no actor — omit it rather than say
    // "Someone". A blocked or since-left actor still resolves through actorName.
    who: entry.actor
      ? actorName(entry.actor, ctx.myProfileId, ctx.blockedIds, ctx.t.misc.someone)
      : null,
    groupLabel: g
      ? [g.cover_emoji, g.name].filter(Boolean).join(' ').trim() || ctx.t.captures.group
      : null,
    groupShort: g ? g.cover_emoji?.trim() || g.name?.trim() || null : null,
    groupId: g?.id ?? null,
    timestamp: activityTimestamp(ctx.locale, entry.created_at, undefined, ctx.rtf),
    tintKey: glyph.tint,
    icon: glyph.icon,
    money: parseMoney(entry.payload),
    stake: entry.stake,
    archived: !!g?.archived_at,
    unavailable: !g,
  };
}

/**
 * The glyph a row wears. A bill being added, deleted or restored shows what it
 * was for — its category's icon and tint, or a guess from its description when
 * it has none — so "Added Dinner" reads as food at a glance; everything else
 * (an edit, a settlement, a join) keeps the verb's own mark.
 */
function rowGlyph(entry: RecentActivityRow): { icon: RowView['icon']; tint: TintName } {
  const billVerb = entry.verb === 'added' || entry.verb === 'deleted' || entry.verb === 'restored';
  if (entry.object_type === 'expense' && billVerb) {
    const description =
      typeof entry.payload.description === 'string' ? entry.payload.description : '';
    const key = entry.category?.key ?? guessCategory(description);
    if (key || entry.category?.meta) {
      const resolved = resolveCategory(key, entry.category?.meta ?? null);
      return { icon: resolved.icon as RowView['icon'], tint: resolved.tint };
    }
  }
  return { icon: verbIcon(entry.verb), tint: verbTint(entry.verb) };
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
  // who · where · when beneath it, and the money on the right in the colour of
  // the reader's side of it — with a ⋮ for where the event leads.
  const tint = theme.tint[view.tintKey];
  const amount = view.stake ?? view.money;
  const ink = view.stake
    ? view.stake.amount > 0n
      ? theme.color.positive
      : view.stake.amount < 0n
        ? theme.color.negative
        : theme.color.textMuted
    : theme.color.text;
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
        marginBottom: 6,
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
        <Ionicons name={view.icon} size={iconSize.md} color={tint.ink} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 15, lineHeight: 20, fontWeight: '600', color: theme.color.text }}
        >
          {view.headline}
        </Text>
        {/* Who · which group · when. The group is named by its mark when it has
            one — the feed spans groups, and the mark is the quickest tell. An
            archived group, or one no longer on this device, gets a badge. */}
        <Row style={{ gap: theme.spacing.xs, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text
            numberOfLines={1}
            style={{ flexShrink: 1, fontSize: 12, lineHeight: 16, color: theme.color.textMuted }}
          >
            {[view.who, view.groupShort, view.timestamp].filter(Boolean).join(' · ')}
          </Text>
          {view.archived ? (
            <Badge label={t.misc.archivedGroup} tone="neutral" />
          ) : view.unavailable ? (
            <Badge label={t.misc.unavailableGroup} tone="neutral" />
          ) : null}
        </Row>
      </View>
      {/* An expense the reader is on shows THEIR side of it, coloured by
          direction, as the ledger and Friends do; anything else keeps the
          neutral total. `payload` is untyped JSON, so a bad amount renders as
          no amount, not a crashed tab. */}
      {amount ? (
        <SplitMoney
          amount={amount.amount}
          currency={amount.currency}
          locale={locale}
          color={ink}
          fontSize={15}
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

/** The feed's filter chips: everything, bills, edits, or one kind of group. */
enum FeedKind {
  All = 'all',
  Expenses = 'expenses',
  Edits = 'edits',
  Trip = 'trip',
}

const EDIT_VERBS = new Set(['edited', 'superseded']);

/** Whether an entry belongs under a filter chip. */
function inKind(entry: RecentActivityRow, kind: FeedKind): boolean {
  switch (kind) {
    case FeedKind.Expenses:
      return entry.object_type === 'expense' && !EDIT_VERBS.has(entry.verb);
    case FeedKind.Edits:
      return EDIT_VERBS.has(entry.verb);
    case FeedKind.Trip:
      return entry.group?.type === GroupType.Trip;
    case FeedKind.All:
    default:
      return true;
  }
}

export default function ActivityScreen() {
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
  const listData = useMemo(() => {
    const ctx: RowContext = { locale, t, myProfileId, blockedIds, rtf };
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
    return rows;
  }, [visibleEntries, locale, t, myProfileId, blockedIds, rtf]);

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

  const kinds: { value: FeedKind; label: string; icon: keyof typeof Ionicons.glyphMap | null }[] = [
    { value: FeedKind.All, label: t.activityScreen.all, icon: null },
    { value: FeedKind.Expenses, label: t.activityScreen.expenses, icon: 'wallet-outline' },
    { value: FeedKind.Edits, label: t.activityScreen.edits, icon: 'create-outline' },
    { value: FeedKind.Trip, label: t.activityScreen.trip, icon: 'airplane-outline' },
  ];

  const header = (
    <View style={{ gap: theme.spacing.sm }}>
      <Row style={{ paddingTop: theme.spacing.sm, alignItems: 'center', gap: theme.spacing.sm }}>
        {/* Activity is pushed, so it carries its own way back — mirrored with
            the writing direction, the same as `groups.tsx`'s header. */}
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.xl}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1 }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Ionicons name="notifications" size={22} color={theme.color.brand} />
            <Text
              style={{ fontSize: 24, lineHeight: 30, fontWeight: '800', color: theme.color.text }}
            >
              {t.activity}
            </Text>
          </Row>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {shownGroup
              ? [shownGroup.cover_emoji, shownGroup.name].filter(Boolean).join(' ')
              : t.activityScreen.subtitle}
          </Text>
        </View>
        {/* A long feed is easier to read a day or a span at a time — the
            calendar opens a range picker clamped to the feed's own start and
            end. A filled glyph in the brand tint marks an active range. */}
        {span ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.activityFilter.open}
            onPress={() => setFilterOpen(true)}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: range ? theme.color.brandSoft : theme.color.surface,
              borderWidth: 1,
              borderColor: theme.color.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons
              name={range ? 'calendar' : 'calendar-outline'}
              size={iconSize.lg}
              color={range ? theme.color.brand : theme.color.text}
            />
          </Pressable>
        ) : null}
      </Row>

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
                height: 34,
                paddingHorizontal: option.icon ? theme.spacing.md : theme.spacing.lg,
                borderRadius: theme.radius.pill,
                backgroundColor: active
                  ? theme.color.brand
                  : theme.scheme === 'dark'
                    ? theme.color.surfaceMuted
                    : '#ECEAF6',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              {option.icon ? <Ionicons name={option.icon} size={iconSize.sm} color={ink} /> : null}
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
            hasGroups ? (
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
      <Screen>
        {/* The same bottom clearance the feed's rows get. Without it this box
            runs on underneath the tab bar, and centring inside it puts the
            artwork below the middle of the part you can actually see — the
            further down the screen, the more of the box is hidden. */}
        <View style={{ flex: 1, paddingHorizontal: theme.spacing.xl, paddingBottom: clearance }}>
          {header}
          {empty}
        </View>
        {picker}
        {menu}
      </Screen>
    );
  }

  return (
    <Screen>
      {/* A feed broken into days: each event is an icon in a soft tile, the
          sentence beside it and the actor/group/time beneath. The day headings
          are what make a long feed skimmable — without them every row had to be
          read to place it in time. */}
      <View style={{ flex: 1 }}>
        {/* The nav header is a fixed sibling above the feed, so only the rows
            scroll under it. Padded to line up with the feed rows below. */}
        <View style={{ paddingHorizontal: theme.spacing.lg }}>{header}</View>
        <FlashList
          data={listData}
          // The row text is locale-formatted and the row's colours come from the
          // theme, so a language or light/dark switch has to re-run renderItem
          // even though the data array is unchanged.
          extraData={`${locale}|${theme.scheme}`}
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
            item.kind === 'header' ? (
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
