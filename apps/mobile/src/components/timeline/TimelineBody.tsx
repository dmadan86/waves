/**
 * The timeline itself — the list and map views, their filters, and opening on
 * a focused bill — without a screen around it.
 *
 * Two homes: the Timeline screen (every group, reached from an expense) and a
 * group's own Timeline tab, which passes `lockedGroupId` so the list is that
 * group's and the group filter is not offered. Everything else is the same
 * component, so the two cannot drift.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { FlashListRef } from '@shopify/flash-list';
import { Pressable, ScrollView, View } from 'react-native';

import { Button, EmptyState, iconSize, SegmentedTabs, Text, useTheme } from '@waves/ui';

import { TimelineList } from '@/components/timeline/TimelineList';
import { TimelineMap } from '@/components/timeline/TimelineMap';
import { useGroupLabeller, useGroups, useMyTimeline } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';
import {
  filterTimeline,
  localDay,
  rowIndexOf,
  timelineDays,
  timelineRows,
  type TimelineEntry,
  type TimelineFilter,
  type TimelineRange,
  type TimelineRow,
} from '@/lib/timeline';

export type TimelineView = 'timeline' | 'map';
type View_ = TimelineView;

export function TimelineBody({
  focusId = null,
  initialView = 'timeline',
  lockedGroupId = null,
}: {
  /** The bill to open on, scrolled into view and marked. */
  focusId?: string | null;
  initialView?: TimelineView;
  /** Show only this group, with no group filter — a group's own tab. */
  lockedGroupId?: string | null;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { choose } = useDialog();
  const clearance = useBottomClearance();

  const [view, setView] = useState<View_>(initialView);
  const [filter, setFilter] = useState<TimelineFilter>({
    range: 'all',
    groupId: lockedGroupId,
    onlyMine: false,
  });

  const timeline = useMyTimeline();
  const groups = useGroups();
  const labelOf = useGroupLabeller();
  // Read once per visit: a screen left open past midnight keeps its day.
  const [today] = useState(() => localDay(Date.now()));

  const entries = useMemo(
    () => filterTimeline(timeline.data, filter, today),
    [timeline.data, filter, today],
  );
  const days = useMemo(() => timelineDays(entries), [entries]);
  const rows = useMemo(() => timelineRows(days), [days]);

  // Opening on the bill the person came from: scroll it a third of the way
  // down, once, as soon as there are rows to scroll.
  const listRef = useRef<FlashListRef<TimelineRow>>(null);
  const scrolledTo = useRef(false);
  const [focusVisible, setFocusVisible] = useState(true);
  const scrollToFocus = (animated: boolean) => {
    if (!focusId) return;
    const index = rowIndexOf(rows, focusId);
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated });
  };
  useEffect(() => {
    if (scrolledTo.current || view !== 'timeline' || rows.length === 0) return;
    // Not done until the focused bill is actually in the rows: the mirror can
    // land a beat after the first rows do, and a scroll to a missing row is lost.
    if (focusId && rowIndexOf(rows, focusId) < 0) return;
    scrolledTo.current = true;
    const handle = setTimeout(() => scrollToFocus(false), 60);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, view]);

  const open = (entry: TimelineEntry) => router.push(`/group/${entry.groupId}/expense/${entry.id}`);

  const rangeLabels: Record<TimelineRange, string> = {
    all: t.timeline.rangeAll,
    '7d': t.timeline.range7,
    '30d': t.timeline.range30,
    '90d': t.timeline.range90,
  };

  const pickRange = async () => {
    const picked = await choose({
      title: t.timeline.rangeTitle,
      options: (['all', '7d', '30d', '90d'] as const).map((id) => ({
        id,
        label: rangeLabels[id],
      })),
    });
    if (picked) setFilter((f) => ({ ...f, range: picked as TimelineRange }));
  };

  const pickGroup = async () => {
    const picked = await choose({
      title: t.timeline.groupTitle,
      options: [
        { id: '*', label: t.timeline.allGroups },
        ...groups.data.map((group) => ({ id: group.id, label: labelOf(group) })),
      ],
    });
    if (picked) setFilter((f) => ({ ...f, groupId: picked === '*' ? null : picked }));
  };

  const chosenGroup = filter.groupId ? groups.data.find((g) => g.id === filter.groupId) : null;
  // A group's own timeline is filtered to that group by being that group's,
  // not by a choice anybody made — so it neither counts as filtered nor is
  // undone by "show all time".
  const filtered =
    filter.range !== 'all' || (filter.groupId !== null && !lockedGroupId) || filter.onlyMine;

  const empty = (
    <View style={{ paddingTop: theme.spacing.xxxl }}>
      <EmptyState
        icon={<Ionicons name="time-outline" size={iconSize.huge} color={theme.color.brand} />}
        title={filtered ? t.timeline.emptyFiltered : t.timeline.empty}
        body={filtered ? undefined : t.timeline.emptyBody}
        action={
          filtered ? (
            <Button
              label={t.timeline.showAllTime}
              variant="secondary"
              onPress={() => setFilter({ range: 'all', groupId: lockedGroupId, onlyMine: false })}
            />
          ) : undefined
        }
      />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <SegmentedTabs<View_>
          value={view}
          onChange={setView}
          tabs={[
            {
              value: 'timeline',
              label: t.timeline.viewTimeline,
              icon: (color) => (
                <Ionicons name="git-commit-outline" size={iconSize.sm} color={color} />
              ),
            },
            {
              value: 'map',
              label: t.timeline.viewMap,
              icon: (color) => <Ionicons name="map-outline" size={iconSize.sm} color={color} />,
            },
          ]}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingVertical: theme.spacing.md,
          gap: theme.spacing.sm,
        }}
      >
        <FilterChip
          icon="calendar-outline"
          label={rangeLabels[filter.range]}
          active={filter.range !== 'all'}
          onPress={() => void pickRange()}
        />
        {lockedGroupId ? null : (
          <FilterChip
            icon="people-outline"
            label={chosenGroup ? labelOf(chosenGroup) : t.timeline.allGroups}
            active={filter.groupId !== null}
            onPress={() => void pickGroup()}
          />
        )}
        <FilterChip
          icon={filter.onlyMine ? 'checkmark-circle' : 'person-outline'}
          label={t.timeline.onlyMine}
          active={filter.onlyMine}
          onPress={() => setFilter((f) => ({ ...f, onlyMine: !f.onlyMine }))}
        />
      </ScrollView>

      {view === 'timeline' ? (
        <View style={{ flex: 1 }}>
          <TimelineList
            ref={listRef}
            rows={rows}
            focusId={focusId}
            onOpen={open}
            onFocusVisible={setFocusVisible}
            empty={empty}
            bottomInset={clearance}
          />
          {focusId && !focusVisible && rowIndexOf(rows, focusId) >= 0 ? (
            <Pressable
              onPress={() => scrollToFocus(true)}
              accessibilityRole="button"
              style={{
                position: 'absolute',
                bottom: clearance + theme.spacing.md,
                alignSelf: 'center',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.sm,
                borderRadius: 999,
                backgroundColor: theme.color.buttonPrimary,
              }}
            >
              <Ionicons name="locate" size={iconSize.sm} color={theme.color.onButtonPrimary} />
              <Text
                variant="caption"
                style={{ color: theme.color.onButtonPrimary, fontWeight: '700' }}
              >
                {t.timeline.backToFocus}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : days.length === 0 ? (
        empty
      ) : (
        <TimelineMap days={days} focusId={focusId} onOpen={open} bottomInset={clearance} />
      )}
    </View>
  );
}

function FilterChip({
  icon,
  label,
  active,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: active ? theme.color.brand : theme.color.surface,
        borderWidth: active ? 0 : 1,
        borderColor: theme.color.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={iconSize.sm}
        color={active ? theme.color.onBrand : theme.color.textMuted}
      />
      <Text
        variant="caption"
        numberOfLines={1}
        style={{
          color: active ? theme.color.onBrand : theme.color.text,
          fontWeight: '600',
          maxWidth: 180,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
