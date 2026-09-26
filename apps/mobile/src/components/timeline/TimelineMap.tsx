/**
 * The timeline as a map: every bill that has a place, as an amount on the map,
 * and a day at a time as a route.
 *
 *  - Pins are amount pills; pins that would overlap merge into one bubble with
 *    the count and total (`clusterPins`). A bubble zooms in; one still crowded
 *    at street level selects its first bill.
 *  - The chosen day's bills are joined in the order they happened, and a card
 *    carousel under the map walks the same bills: swipe a card and the map
 *    follows; tap a pin and the carousel follows.
 *  - A strip of days (only days with a place) picks the day.
 *  - "Replay the day" draws the route stop by stop, the camera following and a
 *    running total counting up, and ends on the day's total.
 *
 * The decisions are in lib/timeline.ts; the native map is TimelineMapSurface,
 * reached through a guarded require so an older build says so instead of dying.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { format, money, type CurrencyCode } from '@waves/core';
import { EmptyState, iconSize, ListRow, MoneyText, Row, Sheet, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import type { TimelineMapHandle } from '@/components/timeline/TimelineMapSurface';
import { expenseTitle } from '@/data/expenseTitle';
import { fill, plural, useStrings } from '@/i18n';
import { useReducedMotion } from '@/lib/reducedMotion';
import {
  clusterPins,
  dayRoute,
  mappedDays,
  pinned,
  regionFor,
  replaySteps,
  type MapRegion,
  type PinCluster,
  type TimelineDay,
  type TimelineEntry,
} from '@/lib/timeline';
import { TimelineMapNative } from '@/lib/timelineMap';

const CARD_GAP = 12;
/** How long each stop holds during a replay, ms. */
const STEP_MS = 1300;
/** How long the day-total card stays when a replay ends, ms. */
const END_MS = 2600;

function formatMoney(amount: bigint, currency: string, locale: string): string {
  return format(money(amount, currency as CurrencyCode), { locale });
}

function shortDay(day: string, locale: string): { weekday: string; date: string } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const at = new Date(y, m - 1, d);
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(at),
    date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at),
  };
}

export function TimelineMap({
  days,
  focusId,
  onOpen,
  bottomInset,
}: {
  days: readonly TimelineDay[];
  focusId: string | null;
  onOpen: (entry: TimelineEntry) => void;
  bottomInset: number;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const reduce = useReducedMotion();
  const { width: screenWidth } = useWindowDimensions();
  const mapRef = useRef<TimelineMapHandle | null>(null);
  const carouselRef = useRef<FlatList<TimelineEntry>>(null);

  const all = useMemo(() => days.flatMap((day) => day.entries), [days]);
  const withPlace = useMemo(() => pinned(all), [all]);
  const withoutPlace = useMemo(() => all.filter((entry) => entry.place === null), [all]);
  const strip = useMemo(() => mappedDays(days), [days]);
  const focus = focusId ? (all.find((entry) => entry.id === focusId) ?? null) : null;

  // The day on the map: the focused bill's, when it has one on the map, else
  // the newest day with a place.
  const [dayKey, setDayKey] = useState<string | null>(() => {
    if (focus && strip.some((day) => day.day === focus.day)) return focus.day;
    return strip[0]?.day ?? null;
  });
  const day = strip.find((d) => d.day === dayKey) ?? strip[0];
  const route = useMemo(() => dayRoute(day), [day]);

  const [selectedId, setSelectedId] = useState<string | null>(() =>
    focus?.place ? focus.id : (route[0]?.id ?? null),
  );

  const initialRegion = useMemo<MapRegion>(() => {
    if (focus?.place) {
      return {
        latitude: focus.place.lat,
        longitude: focus.place.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
    }
    return (
      regionFor(route.map((e) => e.place!)) ??
      regionFor(withPlace.map((e) => e.place!)) ?? {
        latitude: 20.59,
        longitude: 78.96,
        latitudeDelta: 30,
        longitudeDelta: 30,
      }
    );
    // Only the first frame: after that the camera is moved, not re-seeded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [region, setRegion] = useState<MapRegion>(initialRegion);
  const [mapSize, setMapSize] = useState({ width: screenWidth, height: 400 });
  const clusters = useMemo(
    () => clusterPins(withPlace, region, mapSize),
    [withPlace, region, mapSize],
  );

  const cardWidth = screenWidth - theme.spacing.xl * 2 - 28;

  const moveTo = useCallback(
    (entry: TimelineEntry, zoom = 15) => {
      if (!entry.place) return;
      mapRef.current?.animateCamera(
        { center: { latitude: entry.place.lat, longitude: entry.place.lng }, zoom },
        { duration: reduce ? 0 : 650 },
      );
    },
    [reduce],
  );

  const select = useCallback(
    (entry: TimelineEntry, from: 'map' | 'carousel' | 'replay') => {
      setSelectedId(entry.id);
      if (entry.day !== dayKey) setDayKey(entry.day);
      if (from !== 'carousel') {
        const index = dayRoute(strip.find((d) => d.day === entry.day)).findIndex(
          (e) => e.id === entry.id,
        );
        if (index >= 0) {
          requestAnimationFrame(() =>
            carouselRef.current?.scrollToIndex({ index, animated: !reduce }),
          );
        }
      }
      if (from !== 'map') moveTo(entry);
    },
    [dayKey, moveTo, reduce, strip],
  );

  const pickDay = (next: TimelineDay) => {
    stopReplay();
    setDayKey(next.day);
    const points = dayRoute(next);
    setSelectedId(points[0]?.id ?? null);
    carouselRef.current?.scrollToOffset({ offset: 0, animated: false });
    if (points.length > 0) {
      mapRef.current?.fitToCoordinates(
        points.map((e) => ({ latitude: e.place!.lat, longitude: e.place!.lng })),
        {
          edgePadding: { top: 120, right: 60, bottom: 260, left: 60 },
          animated: !reduce,
        },
      );
    }
  };

  const pressCluster = (cluster: PinCluster) => {
    stopReplay();
    if (cluster.entries.length === 1 || region.latitudeDelta < 0.004) {
      select(cluster.entries[0]!, 'map');
      return;
    }
    mapRef.current?.animateToRegion(
      {
        latitude: cluster.lat,
        longitude: cluster.lng,
        latitudeDelta: region.latitudeDelta / 3,
        longitudeDelta: region.longitudeDelta / 3,
      },
      reduce ? 0 : 450,
    );
  };

  // ── Replay the day ────────────────────────────────────────────────────────
  const steps = useMemo(() => replaySteps(day), [day]);
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const stopReplay = () => {
    clearTimer();
    setReplayAt(null);
    setEnded(false);
  };

  // Leaving the screen mid-replay must not leave a timer moving a map that is
  // gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Driven by timers from the tap, not by an effect watching the step: each
  // stop selects its bill, moves the camera and schedules the next, and the
  // last hands over to the day-total card.
  const playFrom = (index: number) => {
    const step = steps[index];
    if (!step) return;
    setReplayAt(index);
    setEnded(false);
    select(step.entry, 'replay');
    timer.current = setTimeout(
      () => {
        if (index + 1 < steps.length) {
          playFrom(index + 1);
          return;
        }
        setEnded(true);
        timer.current = setTimeout(() => {
          setReplayAt(null);
          setEnded(false);
        }, END_MS);
      },
      reduce ? 700 : STEP_MS,
    );
  };

  const replaying = replayAt !== null;
  const drawn = replaying ? route.slice(0, (replayAt ?? 0) + 1) : route;
  const current = replaying ? steps[replayAt ?? 0] : undefined;

  const [noPlaceOpen, setNoPlaceOpen] = useState(false);

  if (!TimelineMapNative) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl }}>
        <EmptyState
          icon={<Ionicons name="map-outline" size={iconSize.huge} color={theme.color.brand} />}
          title={t.timeline.viewMap}
          body={t.timeline.mapUnavailable}
        />
      </View>
    );
  }

  if (withPlace.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl }}>
        <EmptyState
          icon={<Ionicons name="location-outline" size={iconSize.huge} color={theme.color.brand} />}
          title={t.timeline.noPins}
          body={t.timeline.noPinsBody}
        />
      </View>
    );
  }

  const Surface = TimelineMapNative;
  const dayTotals = day
    ? [...day.totals.entries()].map(([c, a]) => formatMoney(a, c, locale)).join(' · ')
    : '';

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        onLayout={(e) =>
          setMapSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
      >
        <Surface
          mapRef={mapRef}
          initialRegion={initialRegion}
          clusters={clusters}
          selectedId={selectedId}
          route={drawn.map((e) => e.place!)}
          locale={locale}
          onRegionChange={setRegion}
          onPressCluster={pressCluster}
        />

        {/* Over the map, top: what is not on it, and the focused bill that is
            not. A chip rather than a banner, so the map stays the subject. */}
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: theme.spacing.md,
            left: theme.spacing.xl,
            right: theme.spacing.xl,
            gap: theme.spacing.sm,
            alignItems: 'flex-start',
          }}
        >
          {focus && !focus.place ? (
            <FloatingNote icon="information-circle-outline" label={t.timeline.focusNoPlace} />
          ) : null}
          {withoutPlace.length > 0 && !replaying ? (
            <Pressable onPress={() => setNoPlaceOpen(true)} accessibilityRole="button">
              <FloatingNote
                icon="location-outline"
                label={plural(locale, withoutPlace.length, t.timeline.noPlaceCount).replace(
                  '{n}',
                  String(withoutPlace.length),
                )}
              />
            </Pressable>
          ) : null}
          {current ? (
            <FloatingNote
              icon="play"
              strong
              label={fill(t.timeline.soFar, {
                amount: formatMoney(current.soFar, current.entry.currency, locale),
              })}
            />
          ) : null}
        </View>

        {ended && day ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: '30%',
              alignSelf: 'center',
              paddingHorizontal: theme.spacing.xl,
              paddingVertical: theme.spacing.lg,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.color.brand,
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Text variant="caption" tone="onBrand" style={{ opacity: 0.85 }}>
              {t.timeline.dayTotal}
            </Text>
            <Text variant="title" tone="onBrand">
              {dayTotals}
            </Text>
            <Text variant="micro" tone="onBrand" style={{ opacity: 0.85 }}>
              {plural(locale, steps.length, t.timeline.stops).replace('{n}', String(steps.length))}
            </Text>
          </View>
        ) : null}
      </View>

      {/* The foot: the day strip with its replay button, then the carousel. */}
      <View
        style={{
          backgroundColor: theme.color.bg,
          borderTopLeftRadius: theme.radius.xl,
          borderTopRightRadius: theme.radius.xl,
          marginTop: -theme.radius.xl,
          paddingTop: theme.spacing.md,
          paddingBottom: bottomInset,
          gap: theme.spacing.md,
        }}
      >
        <Row style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.sm }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: theme.spacing.sm }}
          >
            {strip.map((d) => {
              const on = d.day === day?.day;
              const label = shortDay(d.day, locale);
              return (
                <Pressable
                  key={d.day}
                  onPress={() => pickDay(d)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={{
                    width: 54,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.lg,
                    alignItems: 'center',
                    backgroundColor: on ? theme.color.brand : theme.color.surface,
                    borderWidth: on ? 0 : 1,
                    borderColor: theme.color.border,
                    gap: 2,
                  }}
                >
                  <Text
                    variant="micro"
                    style={{ color: on ? theme.color.onBrand : theme.color.textMuted }}
                  >
                    {label.weekday}
                  </Text>
                  <Text
                    variant="caption"
                    style={{
                      color: on ? theme.color.onBrand : theme.color.text,
                      fontWeight: '700',
                    }}
                    numberOfLines={1}
                  >
                    {label.date}
                  </Text>
                  <View
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 3,
                      backgroundColor: on ? theme.color.onBrand : theme.color.brand,
                    }}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          {steps.length > 1 ? (
            <Pressable
              onPress={() => (replaying ? stopReplay() : playFrom(0))}
              accessibilityRole="button"
              accessibilityLabel={replaying ? t.timeline.stop : t.timeline.replay}
              style={({ pressed }) => ({
                width: 54,
                borderRadius: theme.radius.lg,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.buttonPrimary,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons
                name={replaying ? 'stop' : 'play'}
                size={iconSize.lg}
                color={theme.color.onButtonPrimary}
              />
            </Pressable>
          ) : null}
        </Row>

        <FlatList
          ref={carouselRef}
          data={route}
          horizontal
          keyExtractor={(e) => e.id}
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + CARD_GAP}
          decelerationRate="fast"
          contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, gap: CARD_GAP }}
          getItemLayout={(_, index) => ({
            length: cardWidth + CARD_GAP,
            offset: (cardWidth + CARD_GAP) * index,
            index,
          })}
          onScrollToIndexFailed={() => {}}
          onMomentumScrollEnd={(e) => {
            const index = Math.round(e.nativeEvent.contentOffset.x / (cardWidth + CARD_GAP));
            const entry = route[index];
            if (entry && entry.id !== selectedId) {
              stopReplay();
              select(entry, 'carousel');
            }
          }}
          renderItem={({ item, index }) => (
            <MapCard
              entry={item}
              index={index}
              width={cardWidth}
              selected={item.id === selectedId}
              focused={item.id === focusId}
              onPress={() => (item.id === selectedId ? onOpen(item) : select(item, 'map'))}
            />
          )}
        />
      </View>

      <Sheet
        visible={noPlaceOpen}
        onClose={() => setNoPlaceOpen(false)}
        title={t.timeline.noPlaceTitle}
      >
        <Text variant="caption" tone="muted">
          {t.timeline.noPlaceBody}
        </Text>
        <ScrollView style={{ maxHeight: 420 }}>
          {withoutPlace.map((entry) => (
            <ListRow
              key={entry.id}
              title={expenseTitle(entry.description, entry.category, t, entry.categoryMeta)}
              subtitle={`${shortDay(entry.day, locale).date} · ${entry.groupName}`}
              leading={
                <CategoryBadge
                  category={entry.category}
                  meta={entry.categoryMeta}
                  description={entry.description}
                  size={34}
                />
              }
              trailing={
                <MoneyText
                  amount={entry.amount}
                  currency={entry.currency}
                  locale={locale}
                  variant="caption"
                />
              }
              onPress={() => {
                setNoPlaceOpen(false);
                onOpen(entry);
              }}
            />
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
}

function FloatingNote({
  icon,
  label,
  strong = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  strong?: boolean;
}) {
  const theme = useTheme();
  return (
    <Row
      style={{
        gap: 6,
        alignItems: 'center',
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: strong ? theme.color.brand : theme.color.surface,
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      }}
    >
      <Ionicons
        name={icon}
        size={iconSize.sm}
        color={strong ? theme.color.onBrand : theme.color.brand}
      />
      <Text
        variant="caption"
        style={{ color: strong ? theme.color.onBrand : theme.color.text, fontWeight: '600' }}
      >
        {label}
      </Text>
    </Row>
  );
}

function MapCard({
  entry,
  index,
  width,
  selected,
  focused,
  onPress,
}: {
  entry: TimelineEntry;
  index: number;
  width: number;
  selected: boolean;
  focused: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const title = expenseTitle(entry.description, entry.category, t, entry.categoryMeta);
  const when = [
    shortDay(entry.day, locale).date,
    entry.at !== null
      ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
          new Date(entry.at),
        )
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${formatMoney(entry.amount, entry.currency, locale)}`}
      accessibilityHint={selected ? t.timeline.openExpense : undefined}
      style={({ pressed }) => ({
        width,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surface,
        borderWidth: selected || focused ? 2 : 1,
        borderColor: selected ? theme.color.brand : theme.color.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <CategoryBadge
            category={entry.category}
            meta={entry.categoryMeta}
            description={entry.description}
            size={40}
          />
          <Text variant="micro" tone="faint">
            {index + 1}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="micro" tone="brand" style={{ fontWeight: '700' }} numberOfLines={1}>
            {when}
          </Text>
          <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
            {title}
          </Text>
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {[entry.place?.name?.trim(), entry.groupName].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <MoneyText amount={entry.amount} currency={entry.currency} locale={locale} variant="body" />
      </Row>
    </Pressable>
  );
}
