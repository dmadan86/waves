import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, RefreshControl, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import {
  Button,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { activityDateSpan, dayHeading, filterByDayRange, groupByDay } from '@/data/activity';
import {
  ActivityFeedRow,
  toRowView,
  type RowContext,
  type RowView,
} from '@/components/activity/ActivityFeedRow';
import { useBlockedUsers } from '@/data/blocked';
import { ActivityDateFilter, type DateRange } from '@/components/ActivityDateFilter';
import { FeedSkeleton } from '@/components/Skeletons';
import { useTransitionSettled } from '@/lib/useTransitionSettled';
import { useGroups, useRecentActivity } from '@/data/hooks';
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
type FeedRow =
  | { kind: 'header'; key: string; date: string }
  | { kind: 'row'; key: string; firstOfDay: boolean; view: RowView };

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

  // The feed's own start and end, in the phone's timezone. Clamps the picker so
  // a day outside the activity's span cannot be chosen. Null when the feed is
  // empty — there is then nothing to filter and no button to offer.
  const span = useMemo(() => activityDateSpan(allEntries), [allEntries]);

  // The rows actually shown: the whole feed, or the slice inside the range.
  const visibleEntries = useMemo(
    () => (range ? filterByDayRange(allEntries, range.start, range.end) : allEntries),
    [allEntries, range],
  );

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

  const header = (
    <View>
      <Row style={{ paddingTop: theme.spacing.md, justifyContent: 'space-between' }}>
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          {/* Activity pushes now rather than tabs (it moved off the bar to make
              room for Review, see `(tabs)/_layout.tsx`), so — like every other
              pushed screen — it needs its own way back. Mirrored with the
              writing direction, the same as `groups.tsx`'s header. */}
          <IconButton label={t.common.back} onPress={() => router.back()}>
            <Ionicons
              name={directionalIcon('chevron-back')}
              size={iconSize.xl}
              color={theme.color.text}
            />
          </IconButton>
          <Ionicons name="notifications" size={iconSize.xl} color={theme.color.brand} />
          <View style={{ flexShrink: 1 }}>
            <Text variant="title">{t.activity}</Text>
            {shownGroup ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {[shownGroup.cover_emoji, shownGroup.name].filter(Boolean).join(' ')}
              </Text>
            ) : null}
          </View>
        </Row>
        <Row style={{ alignItems: 'center' }}>
          {/* A long feed is easier to read a day or a span at a time — the
              calendar opens a range picker clamped to the feed's own start and
              end. Only offered once there is a feed to narrow. A filled glyph in
              the brand tint marks an active filter, matching the app's
              filled/outline idiom. */}
          {span ? (
            <IconButton label={t.activityFilter.open} onPress={() => setFilterOpen(true)}>
              <Ionicons
                name={range ? 'calendar' : 'calendar-outline'}
                size={iconSize.lg}
                color={range ? theme.color.brand : theme.color.text}
              />
            </IconButton>
          ) : null}
        </Row>
      </Row>

      {/* The active range as a clearable pill: tap the body to adjust it, the ✕
          to drop back to the full feed. Visible state so a narrowed feed never
          looks like a short one. */}
      {range ? (
        <Row style={{ marginTop: theme.spacing.sm }}>
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
        <View style={{ paddingHorizontal: theme.spacing.xl }}>{header}</View>
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
            paddingHorizontal: theme.spacing.xl,
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
                variant="micro"
                tone="muted"
                style={{
                  textTransform: 'uppercase',
                  // First heading `lg` under the header, later days a section
                  // (`xl`) apart, and each heading `sm` above its rows.
                  marginTop: index === 0 ? theme.spacing.lg : theme.spacing.xl,
                  marginBottom: theme.spacing.sm,
                }}
              >
                {dayHeading(locale, item.date)}
              </Text>
            ) : (
              // The between-row hairline rides on the row itself — above every row
              // but the day's first, so no line falls under a day heading.
              <View
                style={
                  item.firstOfDay
                    ? undefined
                    : { borderTopWidth: 1, borderTopColor: theme.color.border }
                }
              >
                <ActivityFeedRow view={item.view} locale={locale} t={t} theme={theme} />
              </View>
            )
          }
        />
      </View>
      {picker}
    </Screen>
  );
}
