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
import { iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { expenseTitle } from '@/data/expenseTitle';
import { fill, plural, useStrings } from '@/i18n';
import { useReducedMotion } from '@/lib/reducedMotion';
import type { TimelineDay, TimelineEntry, TimelineRow } from '@/lib/timeline';

const TIME_COL = 52;
const RAIL_COL = 22;

export interface TimelineListProps {
  rows: readonly TimelineRow[];
  focusId: string | null;
  onOpen: (entry: TimelineEntry) => void;
  onFocusVisible?: (visible: boolean) => void;
  header?: React.ReactElement | null;
  empty?: React.ReactElement | null;
  bottomInset: number;
}

export const TimelineList = forwardRef<FlashListRef<TimelineRow>, TimelineListProps>(
  function TimelineList(
    { rows, focusId, onOpen, onFocusVisible, header, empty, bottomInset },
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
        extraData={`${focusId ?? ''}|${theme.scheme}`}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header ?? null}
        ListEmptyComponent={empty ?? null}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
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

function DayHeader({ day }: { day: TimelineDay }) {
  const theme = useTheme();
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
        alignItems: 'flex-end',
        paddingTop: theme.spacing.xl,
        paddingBottom: theme.spacing.sm,
      }}
    >
      <Text variant="subheading">{label}</Text>
      <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
        {totals}
      </Text>
    </Row>
  );
}

function GapRow({ hours }: { hours: number }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  return (
    <Row style={{ alignItems: 'center', minHeight: 30 }}>
      <View style={{ width: TIME_COL }} />
      <View style={{ width: RAIL_COL, alignItems: 'center', alignSelf: 'stretch' }}>
        <View
          style={{
            flex: 1,
            width: 0,
            borderLeftWidth: 2,
            borderStyle: 'dashed',
            borderColor: theme.color.border,
          }}
        />
      </View>
      <Text variant="micro" tone="faint" style={{ marginStart: theme.spacing.sm }}>
        {plural(locale, hours, t.timeline.quietFor).replace('{n}', String(hours))}
      </Text>
    </Row>
  );
}

function EntryRow({
  entry,
  first,
  last,
  focused,
  onOpen,
}: {
  entry: TimelineEntry;
  first: boolean;
  last: boolean;
  focused: boolean;
  onOpen: (entry: TimelineEntry) => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const title = expenseTitle(entry.description, entry.category, t, entry.categoryMeta);
  const time =
    entry.at !== null
      ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
          new Date(entry.at),
        )
      : null;
  const share =
    entry.myNet > 0n
      ? fill(t.timeline.youLent, { amount: formatMoney(entry.myNet, entry.currency, locale) })
      : entry.myNet < 0n
        ? fill(t.timeline.youBorrowed, {
            amount: formatMoney(-entry.myNet, entry.currency, locale),
          })
        : null;

  return (
    <Row style={{ alignItems: 'stretch' }}>
      <View style={{ width: TIME_COL, paddingTop: theme.spacing.lg }}>
        <Text variant="micro" tone={time ? 'muted' : 'faint'} numberOfLines={2}>
          {time ?? t.timeline.addedLater}
        </Text>
      </View>
      <View style={{ width: RAIL_COL, alignItems: 'center' }}>
        {/* The rail: above the dot unless this is the day's first bill, below
            it unless it is the last, so each day is one continuous line. */}
        <View
          style={{
            width: 2,
            height: theme.spacing.lg + 4,
            backgroundColor: first ? 'transparent' : theme.color.border,
          }}
        />
        <Dot focused={focused} />
        <View
          style={{ width: 2, flex: 1, backgroundColor: last ? 'transparent' : theme.color.border }}
        />
      </View>
      <Pressable
        onPress={() => onOpen(entry)}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${formatMoney(entry.amount, entry.currency, locale)}`}
        accessibilityHint={t.timeline.openExpense}
        style={({ pressed }) => ({
          flex: 1,
          marginStart: theme.spacing.sm,
          marginVertical: theme.spacing.xs,
          padding: theme.spacing.md,
          borderRadius: theme.radius.lg,
          backgroundColor: focused ? theme.color.brandSoft : theme.color.surface,
          borderWidth: focused ? 2 : 1,
          borderColor: focused ? theme.color.brand : theme.color.border,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
          <CategoryBadge
            category={entry.category}
            meta={entry.categoryMeta}
            description={entry.description}
            size={36}
          />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
              {title}
            </Text>
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {entry.groupName}
            </Text>
            {entry.place ? (
              <Row style={{ gap: 3, alignItems: 'center' }}>
                <Ionicons name="location" size={iconSize.xs} color={theme.color.brand} />
                <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {entry.place.name?.trim() ||
                    `${entry.place.lat.toFixed(3)}, ${entry.place.lng.toFixed(3)}`}
                </Text>
              </Row>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <MoneyText
              amount={entry.amount}
              currency={entry.currency}
              locale={locale}
              variant="body"
            />
            {share ? (
              <Text
                variant="micro"
                style={{
                  color: entry.myNet > 0n ? theme.color.positive : theme.color.negative,
                  fontWeight: '600',
                }}
                numberOfLines={1}
              >
                {share}
              </Text>
            ) : null}
          </View>
        </Row>
      </Pressable>
    </Row>
  );
}

/** The rail's dot. The focused bill's rings once when it comes into view. */
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
  const size = focused ? 14 : 10;
  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      <Reanimated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: theme.color.brand,
          },
          ringStyle,
        ]}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: focused ? theme.color.brand : theme.color.surface,
          borderWidth: 2,
          borderColor: theme.color.brand,
        }}
      />
    </View>
  );
}
