/**
 * The body of the group-settings Dates sheet: a header, the start/end strip,
 * one month calendar and a pinned Save button.
 *
 * The selection is a draft held here. Nothing reaches the group until Save,
 * and closing the sheet any other way throws the draft away — the parent
 * mounts this only while the sheet is open, so every opening starts from the
 * saved range. Clearing is also just an edit to the draft: Save then writes
 * null dates (`{ start_date: null, end_date: null }`, the same patch the
 * inline TripDates editor uses).
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import type { TripDatesPatch, TripDatesValue } from '@/components/TripDates';
import { plural, useStrings } from '@/i18n';
import {
  addMonths,
  dayAt,
  firstOfMonth,
  firstWeekday,
  gregorianFormatter,
  sameDay,
  startOfDay,
} from '@/lib/calendarGrid';
import { inclusiveTripDays, tripDateFromIso, tripDateRangePatch } from '@/lib/tripDateRange';

const CELL = 40;
const TILE = 28;

/** Which end the next calendar tap sets. `fresh` starts a new range. */
type Target = 'fresh' | 'start' | 'end';

function Tile({ size = TILE, name }: { size?: number; name: 'calendar-outline' }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.md,
        backgroundColor: theme.color.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name} size={Math.round(size * 0.55)} color={theme.color.brand} />
    </View>
  );
}

export function DatesSheetBody({
  group,
  locale,
  forEvent,
  onSave,
  onClose,
}: {
  group: TripDatesValue;
  locale: string;
  forEvent: boolean;
  onSave: (patch: TripDatesPatch) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();

  const [start, setStart] = useState<Date | null>(() => tripDateFromIso(group.start_date));
  const [end, setEnd] = useState<Date | null>(() => tripDateFromIso(group.end_date));
  const [target, setTarget] = useState<Target>('fresh');
  const [view, setView] = useState<Date>(() =>
    firstOfMonth(tripDateFromIso(group.start_date) ?? new Date()),
  );

  const fmt = useMemo(() => {
    const date = gregorianFormatter(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const month = gregorianFormatter(locale, { month: 'long', year: 'numeric' });
    const weekday = gregorianFormatter(locale, { weekday: 'short' });
    const full = gregorianFormatter(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    let number: Intl.NumberFormat | null = null;
    try {
      number = new Intl.NumberFormat(locale);
    } catch {
      // Western digits are the fallback.
    }
    return {
      date: (d: Date | null): string =>
        d ? (date?.format(d) ?? d.toDateString()) : t.pickers.notSet,
      month: (d: Date): string => month?.format(d) ?? `${d.getFullYear()}-${d.getMonth() + 1}`,
      weekday: (d: Date): string => weekday?.format(d) ?? '',
      full: (d: Date): string => full?.format(d) ?? d.toDateString(),
      day: (n: number): string => number?.format(n) ?? String(n),
    };
  }, [locale, t]);

  const weekStart = useMemo(() => firstWeekday(locale), [locale]);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    fmt.weekday(dayAt(2023, 0, 1 + ((weekStart + i) % 7))),
  );

  // Whole weeks covering the month, with the neighbouring months' days filling
  // the lead and trail slots (drawn faint).
  const weeks = useMemo(() => {
    const first = firstOfMonth(view);
    const lead = (first.getDay() - weekStart + 7) % 7;
    const days = dayAt(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    const count = Math.ceil((lead + days) / 7);
    return Array.from({ length: count }, (_, w) =>
      Array.from({ length: 7 }, (_, d) =>
        dayAt(view.getFullYear(), view.getMonth(), 1 - lead + w * 7 + d),
      ),
    );
  }, [view, weekStart]);

  const pick = (d: Date): void => {
    if (target === 'start') {
      setStart(d);
      if (end && end.getTime() >= d.getTime()) {
        setTarget('fresh');
      } else {
        setEnd(null);
        setTarget('end');
      }
    } else if (target === 'end' && start) {
      if (d.getTime() < start.getTime()) {
        setEnd(start);
        setStart(d);
      } else {
        setEnd(d);
      }
      setTarget('fresh');
    } else {
      setStart(d);
      setEnd(null);
      setTarget('end');
    }
  };

  const clear = (): void => {
    setStart(null);
    setEnd(null);
    setTarget('fresh');
  };

  const save = (): void => {
    if (!start) onSave({ start_date: null, end_date: null });
    else onSave(tripDateRangePatch(start, end ?? start, group.time_zone));
    onClose();
  };

  const lo = start && end && start > end ? end : start;
  const hi = start && end && start > end ? start : (end ?? start);
  const today = startOfDay(new Date());
  const days = lo && hi ? inclusiveTripDays(lo, hi) : 0;

  const half = (which: 'start' | 'end', label: string, value: Date | null): React.JSX.Element => {
    const active = target === which;
    const tile = <Tile name="calendar-outline" />;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${fmt.date(value)}`}
        accessibilityState={{ selected: active }}
        onPress={() => setTarget(which)}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: theme.spacing.xs,
          paddingHorizontal: 6,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: active ? theme.color.brand : 'transparent',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {which === 'start' ? tile : null}
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {label}
          </Text>
          <Text
            variant="body"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={{
              fontWeight: '700',
              color: value ? theme.color.text : theme.color.textMuted,
            }}
          >
            {fmt.date(value)}
          </Text>
        </View>
        {which === 'end' ? tile : null}
      </Pressable>
    );
  };

  const circleBtn = (
    icon: 'chevron-back' | 'chevron-forward',
    label: string,
    onPress: () => void,
  ): React.JSX.Element => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.color.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={directionalIcon(icon)} size={iconSize.md} color={theme.color.brand} />
    </Pressable>
  );

  return (
    <View style={{ flexShrink: 1, gap: theme.spacing.md }}>
      <ScrollView
        style={{ flexGrow: 0, flexShrink: 1 }}
        contentContainerStyle={{ gap: theme.spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header: tile, title and subtitle, close. */}
        <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <Tile size={48} name="calendar-outline" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" accessibilityRole="header" numberOfLines={1}>
              {forEvent ? t.eventOrganizer.eventDatesTitle : t.misc.tripDatesTitle}
            </Text>
            <Text variant="caption" tone="muted">
              {t.pickers.datesSheetSubtitle}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            onPress={onClose}
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}
          >
            <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
          </Pressable>
        </Row>

        {/* The range strip: two halves and an arrow. */}
        <Row
          style={{
            alignItems: 'center',
            gap: 4,
            padding: 6,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.brandSoft,
          }}
        >
          {half('start', t.pickers.startDate, start && lo ? lo : start)}
          <Ionicons
            name={directionalIcon('arrow-forward')}
            size={iconSize.sm}
            color={theme.color.textMuted}
          />
          {half('end', t.pickers.endDate, end && hi ? hi : end)}
        </Row>

        {/* The calendar card. */}
        <View
          style={{
            padding: theme.spacing.sm,
            gap: theme.spacing.sm,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            {circleBtn('chevron-back', fmt.month(addMonths(view, -1)), () =>
              setView((v) => addMonths(v, -1)),
            )}
            <Text variant="subheading" style={{ fontWeight: '700' }}>
              {fmt.month(view)}
            </Text>
            {circleBtn('chevron-forward', fmt.month(addMonths(view, 1)), () =>
              setView((v) => addMonths(v, 1)),
            )}
          </Row>

          <Row gap={0}>
            {weekdays.map((w, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                <Text variant="micro" tone="faint" numberOfLines={1} style={{ fontWeight: '600' }}>
                  {w}
                </Text>
              </View>
            ))}
          </Row>

          <View>
            {weeks.map((week, wi) => (
              <Row key={wi} gap={0}>
                {week.map((d, di) => {
                  const isFrom = lo !== null && sameDay(d, lo);
                  const isTo = hi !== null && sameDay(d, hi);
                  const isEnd = isFrom || isTo;
                  const inside =
                    lo !== null &&
                    hi !== null &&
                    d.getTime() > lo.getTime() &&
                    d.getTime() < hi.getTime();
                  const bandFrom = isFrom && !isTo;
                  const bandTo = isTo && !isFrom;
                  const otherMonth = d.getMonth() !== view.getMonth();
                  return (
                    <Pressable
                      key={di}
                      accessibilityRole="button"
                      accessibilityLabel={fmt.full(d)}
                      accessibilityState={{ selected: isEnd }}
                      onPress={() => pick(d)}
                      style={{
                        flex: 1,
                        height: CELL + 4,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: inside ? theme.color.brandSoft : 'transparent',
                      }}
                    >
                      {bandFrom || bandTo ? (
                        <View
                          pointerEvents="none"
                          style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            start: bandFrom ? '50%' : 0,
                            end: bandTo ? '50%' : 0,
                            backgroundColor: theme.color.brandSoft,
                          }}
                        />
                      ) : null}
                      <View
                        style={{
                          width: CELL,
                          height: CELL,
                          borderRadius: CELL / 2,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: isEnd ? theme.color.brand : 'transparent',
                          borderWidth: !isEnd && sameDay(d, today) ? 1 : 0,
                          borderColor: theme.color.brand,
                        }}
                      >
                        <Text
                          variant="body"
                          style={{
                            color: isEnd
                              ? theme.color.onBrand
                              : otherMonth
                                ? theme.color.textFaint
                                : theme.color.text,
                            fontWeight: isEnd ? '700' : '500',
                          }}
                        >
                          {fmt.day(d.getDate())}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </Row>
            ))}
          </View>

          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Tile size={36} name="calendar-outline" />
            <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
              {days > 0 ? plural(locale, days, t.pickers.daysSelected) : t.pickers.noDatesSelected}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.pickers.clearDates}
              onPress={clear}
              hitSlop={6}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.brandSoft,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="close" size={iconSize.sm} color={theme.color.brand} />
              <Text
                variant="caption"
                numberOfLines={1}
                style={{ color: theme.color.brand, fontWeight: '600' }}
              >
                {t.pickers.clearDates}
              </Text>
            </Pressable>
          </Row>
        </View>
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.pickers.saveDates}
        onPress={save}
        style={({ pressed }) => ({
          height: 52,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color.brand,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text variant="subheading" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
          {t.pickers.saveDates}
        </Text>
      </Pressable>
    </View>
  );
}
