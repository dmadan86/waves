/**
 * The timeline as a list: a header per day with the day's total, and a rail
 * down the left with a dot and a time for each bill, the way an itinerary reads.
 *
 * The rows come from `timelineRows` (lib/timeline.ts). This file only draws
 * them: the focused bill (the one the person came from) is outlined and its dot
 * rings once, and a quiet stretch of the day is a dashed piece of rail with how
 * long it was.
 */

import { forwardRef, useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Pressable, View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { format, money, type CurrencyCode } from '@waves/core';
import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { expenseTitle } from '@/data/expenseTitle';
import { fill, plural, useStrings } from '@/i18n';
import { useReducedMotion } from '@/lib/reducedMotion';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';
import type { TimelineDay, TimelineEntry, TimelineRow } from '@/lib/timeline';

const TIME_COL = 40;
const RAIL_COL = 18;
/** Equal space either side of the rail: time | gap | rail | gap | card. */
const RAIL_GAP = 6;

export interface TimelineListProps {
  rows: readonly TimelineRow[];
  focusId: string | null;
  onOpen: (entry: TimelineEntry) => void;
  onFocusVisible?: (visible: boolean) => void;
  header?: React.ReactElement | null;
  empty?: React.ReactElement | null;
  bottomInset: number;
  /** Name the people on each bill rather than its group — a group's own tab. */
  showPeople?: boolean;
}

export const TimelineList = forwardRef<FlashListRef<TimelineRow>, TimelineListProps>(
  function TimelineList(
    { rows, focusId, onOpen, onFocusVisible, header, empty, bottomInset, showPeople = false },
    ref,
  ) {
    const theme = useTheme();
    return (
      <FlashList
        ref={ref}
        data={rows as TimelineRow[]}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        drawDistance={2500}
        extraData={`${focusId ?? ''}|${theme.scheme}|${showPeople}`}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header ?? null}
        ListEmptyComponent={empty ?? null}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: bottomInset,
        }}
        onViewableItemsChanged={
          onFocusVisible && focusId
            ? ({ viewableItems }) =>
                onFocusVisible(
                  viewableItems.some(
                    (item) =>
                      (item.item as TimelineRow).kind === 'entry' &&
                      (item.item as Extract<TimelineRow, { kind: 'entry' }>).entry.id === focusId,
                  ),
                )
            : undefined
        }
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <DayHeader day={item.day} />
          ) : item.kind === 'gap' ? (
            <GapRow hours={item.hours} />
          ) : (
            <EntryRow
              entry={item.entry}
              first={item.first}
              last={item.last}
              focused={item.entry.id === focusId}
              showPeople={showPeople}
              onOpen={onOpen}
            />
          )
        }
      />
    );
  },
);

function formatMoney(amount: bigint, currency: string, locale: string): string {
  return format(money(amount, currency as CurrencyCode), { locale });
}

/** The ink and the quieter grey the redesign draws the timeline in. */
function useInks() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return {
    ink: dark ? theme.color.text : SPEC_INK,
    muted: dark ? theme.color.textMuted : SPEC_MUTED,
    rail: dark ? theme.color.border : '#E3E1F0',
    lent: dark ? '#8FB4FF' : '#2E63E0',
  };
}

function DayHeader({ day }: { day: TimelineDay }) {
  const theme = useTheme();
  const { ink, muted } = useInks();
  const { locale } = useStrings();
  const [y, m, d] = day.day.split('-').map(Number) as [number, number, number];
  const label = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(y, m - 1, d));
  const totals = [...day.totals.entries()]
    .map(([currency, amount]) => formatMoney(amount, currency, locale))
    .join(' · ');
  return (
    <Row
      style={{
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingTop: theme.spacing.md,
        paddingBottom: 2,
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: '800', color: ink }}>{label}</Text>
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: 13, color: muted, fontVariant: ['tabular-nums'] }}
      >
        {totals}
      </Text>
    </Row>
  );
}

function GapRow({ hours }: { hours: number }) {
  const theme = useTheme();
  const { muted, rail } = useInks();
  const { t, locale } = useStrings();
  return (
    <Row style={{ alignItems: 'center', minHeight: 20 }}>
      <View style={{ width: TIME_COL }} />
      <View
        style={{
          width: RAIL_COL,
          alignItems: 'center',
          alignSelf: 'stretch',
          marginHorizontal: RAIL_GAP,
        }}
      >
        <View
          style={{
            flex: 1,
            width: 0,
            borderLeftWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: rail,
          }}
        />
      </View>
      <Text style={{ fontSize: 11, color: muted }}>
        {plural(locale, hours, t.timeline.quietFor).replace('{n}', String(hours))}
      </Text>
    </Row>
  );
}

/** "7:00" over "PM": the time and its half of the day on lines of their own,
 *  so a narrow column never breaks it mid-word. */
function timeParts(at: number, locale: string): [string, string] {
  const parts = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(new Date(at));
  const period = parts.find((part) => part.type === 'dayPeriod')?.value ?? '';
  const clock = parts
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
  return [clock, period];
}

/** The amount with its minor digits drawn lighter: ₹500 and a quiet .00. */
function SplitAmount({ text, color }: { text: string; color: string }) {
  const match = /^(.*\d)([.,]\d{1,3})$/.exec(text);
  return (
    <Text
      numberOfLines={1}
      style={{ fontSize: 14, fontWeight: '700', color, fontVariant: ['tabular-nums'] }}
    >
      {match ? match[1] : text}
      {match ? <Text style={{ fontWeight: '400', color, fontSize: 14 }}>{match[2]}</Text> : null}
    </Text>
  );
}

function EntryRow({
  entry,
  first,
  last,
  focused,
  showPeople,
  onOpen,
}: {
  entry: TimelineEntry;
  first: boolean;
  last: boolean;
  focused: boolean;
  showPeople: boolean;
  onOpen: (entry: TimelineEntry) => void;
}) {
  const theme = useTheme();
  const { ink, muted, rail, lent } = useInks();
  const { t, locale } = useStrings();
  const title = expenseTitle(entry.description, entry.category, t, entry.categoryMeta);
  const time = entry.at !== null ? timeParts(entry.at, locale) : null;
  const amount = formatMoney(entry.amount, entry.currency, locale);
  const share =
    entry.myNet > 0n
      ? fill(t.timeline.youLent, { amount: formatMoney(entry.myNet, entry.currency, locale) })
      : entry.myNet < 0n
        ? fill(t.timeline.youBorrowed, {
            amount: formatMoney(-entry.myNet, entry.currency, locale),
          })
        : null;
  // "You, Rvs Amirnath +2" on a group's own timeline, where the group's name
  // would say nothing; the group's name on the one that spans them all.
  const people = (() => {
    if (!showPeople || !entry.others) return entry.groupName;
    const names = [
      ...(entry.mine ? [t.person.you] : []),
      ...entry.others.map((name) => name ?? t.misc.someone),
    ];
    if (names.length === 0) return entry.groupName;
    const shown = names.slice(0, 2).join(', ');
    return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
  })();

  return (
    <Row style={{ alignItems: 'stretch' }}>
      <View style={{ width: TIME_COL, paddingTop: theme.spacing.md, alignItems: 'flex-end' }}>
        {time ? (
          <>
            <Text style={{ fontSize: 12, lineHeight: 15, color: muted }}>{time[0]}</Text>
            {time[1] ? (
              <Text style={{ fontSize: 11, lineHeight: 14, color: muted }}>{time[1]}</Text>
            ) : null}
          </>
        ) : (
          <Text
            numberOfLines={2}
            style={{ fontSize: 11, lineHeight: 14, color: muted, textAlign: 'right' }}
          >
            {t.timeline.addedLater}
          </Text>
        )}
      </View>
      {/* The rail sits the same distance from the time and from the card. */}
      <View style={{ width: RAIL_COL, alignItems: 'center', marginHorizontal: RAIL_GAP }}>
        {/* The rail: above the dot unless this is the day's first bill, below
            it unless it is the last, so each day is one continuous line. */}
        <View
          style={{
            width: 1.5,
            height: theme.spacing.md + 2,
            backgroundColor: first ? 'transparent' : rail,
          }}
        />
        <Dot focused={focused} />
        <View style={{ width: 1.5, flex: 1, backgroundColor: last ? 'transparent' : rail }} />
      </View>
      <Pressable
        onPress={() => onOpen(entry)}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${people}, ${amount}${share ? `, ${share}` : ''}`}
        accessibilityHint={t.timeline.openExpense}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          marginVertical: 3,
          paddingVertical: theme.spacing.sm,
          paddingStart: theme.spacing.sm + 2,
          paddingEnd: theme.spacing.xs,
          borderRadius: 16,
          backgroundColor: focused ? theme.color.brandSoft : theme.color.surface,
          borderWidth: focused ? 1.5 : 0,
          borderColor: theme.color.brand,
          shadowColor: '#2A1E6B',
          shadowOpacity: theme.scheme === 'dark' ? 0 : 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 3 },
          elevation: 1,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Row style={{ gap: theme.spacing.sm + 2, alignItems: 'center' }}>
          <CategoryBadge
            category={entry.category}
            meta={entry.categoryMeta}
            description={entry.description}
            size={34}
          />
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Row style={{ alignItems: 'baseline', gap: theme.spacing.sm }}>
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontSize: 14, fontWeight: '700', color: ink }}
              >
                {title}
              </Text>
              <SplitAmount text={amount} color={ink} />
            </Row>
            <Row style={{ alignItems: 'baseline', gap: theme.spacing.sm }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: muted }}>
                {people}
              </Text>
              {share ? (
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12,
                    fontWeight: '500',
                    color: entry.myNet > 0n ? lent : theme.color.negative,
                  }}
                >
                  {share}
                </Text>
              ) : null}
            </Row>
            {entry.place ? (
              <Row style={{ gap: 3, alignItems: 'center' }}>
                <Ionicons name="location-outline" size={iconSize.xs} color={muted} />
                <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 11, color: muted }}>
                  {entry.place.name?.trim() ||
                    `${entry.place.lat.toFixed(3)}, ${entry.place.lng.toFixed(3)}`}
                </Text>
              </Row>
            ) : null}
          </View>
          <Ionicons name={directionalIcon('chevron-forward')} size={14} color={muted} />
        </Row>
      </Pressable>
    </Row>
  );
}

/** The rail's dot: a hollow violet ring. The focused bill's is filled and rings
 *  once when it comes into view. */
function Dot({ focused }: { focused: boolean }) {
  const theme = useTheme();
  const reduce = useReducedMotion();
  const ring = useSharedValue(0);
  useEffect(() => {
    if (!focused || reduce) return;
    ring.value = withSequence(withTiming(1, { duration: 600 }), withTiming(0, { duration: 0 }));
  }, [focused, reduce, ring]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value === 0 ? 0 : 1 - ring.value,
    transform: [{ scale: 1 + ring.value * 1.6 }],
  }));
  const brand = theme.scheme === 'dark' ? theme.color.brand : SPEC_ACCENT;
  const size = 11;
  return (
    <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
      <Reanimated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: brand,
          },
          ringStyle,
        ]}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: focused ? brand : theme.color.bg,
          borderWidth: 2,
          borderColor: brand,
        }}
      />
    </View>
  );
}
