/**
 * An inline month calendar with range selection — the modern date-range control
 * (Monzo, Spotify, StubHub, and every travel app: Airbnb, Booking.com, Vrbo,
 * Agoda): one calendar on screen, tap the start day then the end day, the span
 * between them tinted. It replaces the old from/to pair that opened a native
 * picker modal per end (open, pick, dismiss, open, pick, dismiss — four taps
 * before Apply). Here a range is two taps on a calendar that never leaves the
 * screen.
 *
 * Pure React Native, no calendar dependency: the grid is simple enough to build
 * by hand, and a native calendar library would turn every screen that picks
 * dates into a store release instead of an over-the-air update. This file is
 * only the drawing of it — the day arithmetic, the reader's first weekday and
 * the Gregorian pinning of the labels all live in `@/lib/calendarGrid`, where
 * they can be tested without a renderer. Every day is anchored at local noon, so
 * the grid is DST-proof and agrees with the day anchors its callers commit.
 *
 * Bounds are optional. The activity feed clamps to the span it actually holds
 * (`earliest`/`latest`), because a day before the first event or after the last
 * is empty time; a trip has no such bounds — it may have happened last year or
 * be booked for next — so leaving them off pages freely in both directions.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import {
  addMonths,
  dayAt,
  firstOfMonth,
  firstWeekday,
  gregorianFormatter,
  monthGrid,
  sameDay,
  startOfDay,
} from '@/lib/calendarGrid';

/**
 * A day cell's height, and the diameter the day's own circle is drawn at.
 *
 * Not its width: the seven columns share the width they are given, so the grid
 * is exactly as wide as whatever holds it. It used to be a width too, and seven
 * fixed cells with `Row`'s default 12pt gap between them came to 352 points —
 * wider than the content box of a sheet on a 360pt phone, which pushed the grid
 * (and everything else sharing that scroll column, such as the From/To line) off
 * the right-hand edge. The gap did a second kind of damage: it broke the tinted
 * span between the two ends into stripes, since a band drawn inside a cell
 * cannot cross the gap to the next one.
 */
const CELL = 40;

/**
 * How wide the calendar is allowed to get before it stops growing.
 *
 * Columns that share the width need a ceiling, or on a tablet seven day circles
 * drift to the far corners of a very wide row with the tint band stretched
 * between them. Roughly a large phone's grid: past that the calendar centres
 * itself in whatever it was given.
 */
const MAX_GRID_WIDTH = 7 * 56;

export function RangeCalendar({
  earliest = null,
  latest = null,
  locale,
  start,
  end,
  onSelect,
}: {
  /** The earliest selectable day, or null for no lower bound. */
  earliest?: Date | null;
  /** The latest selectable day, or null for no upper bound. */
  latest?: Date | null;
  locale: string;
  start: Date | null;
  end: Date | null;
  /** Emits the new range ends after a tap; `end` is null mid-selection. */
  onSelect: (start: Date | null, end: Date | null) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const lo = earliest ? startOfDay(earliest) : null;
  const hi = latest ? startOfDay(latest) : null;

  // Which month the grid shows — opens on the current start, else on the upper
  // bound's month (the newest activity, where a feed's reader most likely
  // looks), else on today's, which is where an unbounded picker belongs.
  const [view, setView] = useState<Date>(() => firstOfMonth(start ?? latest ?? new Date()));

  const canPrev = lo === null || firstOfMonth(view).getTime() > firstOfMonth(lo).getTime();
  const canNext = hi === null || firstOfMonth(view).getTime() < firstOfMonth(hi).getTime();

  const inBounds = (d: Date): boolean =>
    (lo === null || d.getTime() >= lo.getTime()) && (hi === null || d.getTime() <= hi.getTime());

  // The three formatters the grid needs, built once per language rather than
  // once per cell — a 42-cell grid re-formatting on every render is the kind of
  // cost that only shows up on the cheap phone somebody actually owns.
  const format = useMemo(() => {
    const month = gregorianFormatter(locale, { month: 'long', year: 'numeric' });
    const weekday = gregorianFormatter(locale, { weekday: 'narrow' });
    const full = gregorianFormatter(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    let number: Intl.NumberFormat | null = null;
    try {
      number = new Intl.NumberFormat(locale);
    } catch {
      // Western digits are the fallback, and they are legible everywhere.
    }
    return {
      month: (d: Date): string => month?.format(d) ?? `${d.getFullYear()}-${d.getMonth() + 1}`,
      weekday: (d: Date): string => weekday?.format(d) ?? '',
      full: (d: Date): string => full?.format(d) ?? d.toDateString(),
      day: (n: number): string => number?.format(n) ?? String(n),
    };
  }, [locale]);

  // Where the week begins for this reader, and the seven initials in that
  // order. 2023-01-01 was a Sunday, so walking from it plus the offset gives
  // each column's day without any date arithmetic worth checking twice.
  const weekStart = useMemo(() => firstWeekday(locale), [locale]);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    format.weekday(dayAt(2023, 0, 1 + ((weekStart + i) % 7))),
  );

  // The selection span, ordered, for the tint band.
  const spanLo = start && end ? (start <= end ? start : end) : start;
  const spanHi = start && end ? (start <= end ? end : start) : start;
  const inSpan = (d: Date): boolean =>
    spanLo !== null &&
    spanHi !== null &&
    d.getTime() >= spanLo.getTime() &&
    d.getTime() <= spanHi.getTime();

  const today = startOfDay(new Date());

  const pick = (d: Date): void => {
    // Fresh start when nothing is pending or the range is already whole; else
    // close the range on the second tap. Callers order the two ends, so an
    // end-before-start tap is fine.
    if (start === null || end !== null) onSelect(d, null);
    else onSelect(start, d);
  };

  const weeks = monthGrid(view, weekStart);

  return (
    <View
      style={{
        gap: theme.spacing.sm,
        width: '100%',
        maxWidth: MAX_GRID_WIDTH,
        alignSelf: 'center',
      }}
    >
      {/* Month header with ‹ › paging, clamped to the caller's months. */}
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={format.month(addMonths(view, -1))}
          disabled={!canPrev}
          onPress={() => setView((v) => addMonths(v, -1))}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: !canPrev ? 0.3 : pressed ? 0.5 : 1, padding: 4 })}
        >
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.md}
            color={theme.color.text}
          />
        </Pressable>
        <Text variant="subheading" style={{ fontWeight: '700' }}>
          {format.month(view)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={format.month(addMonths(view, 1))}
          disabled={!canNext}
          onPress={() => setView((v) => addMonths(v, 1))}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: !canNext ? 0.3 : pressed ? 0.5 : 1, padding: 4 })}
        >
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.md}
            color={theme.color.text}
          />
        </Pressable>
      </Row>

      {/* Weekday initials. The row is a plain `row`, which React Native reverses
          under RTL, so the first weekday lands on the side the reader starts
          from and the columns below line up with it either way. */}
      <Row gap={0}>
        {weekdays.map((w, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="micro" tone="faint" style={{ fontWeight: '600' }}>
              {w}
            </Text>
          </View>
        ))}
      </Row>

      {/* The day grid. */}
      <View style={{ gap: 2 }}>
        {weeks.map((week, wi) => (
          <Row key={wi} gap={0}>
            {week.map((d, di) => {
              if (!d) return <View key={di} style={{ flex: 1, height: CELL }} />;
              const disabled = !inBounds(d);
              const isFrom = spanLo !== null && sameDay(d, spanLo);
              const isTo = spanHi !== null && sameDay(d, spanHi);
              const isEnd = isFrom || isTo;
              const banded = inSpan(d) && !isEnd;
              // The band runs under the two end circles as well, as a half each,
              // so a chosen range reads as one continuous bar rather than a
              // circle, a gap, a bar, a gap and another circle. `start`/`end`
              // rather than `left`/`right`: they are the direction-relative
              // insets, so the half that points at the rest of the range keeps
              // pointing at it when the whole grid mirrors for Arabic. A range
              // of one day gets no band at all — there is nothing to span.
              const bandFrom = isFrom && !isTo;
              const bandTo = isTo && !isFrom;
              return (
                <Pressable
                  key={di}
                  accessibilityRole="button"
                  accessibilityLabel={format.full(d)}
                  accessibilityState={{ disabled, selected: isEnd }}
                  disabled={disabled}
                  onPress={() => pick(d)}
                  style={{
                    // A seventh of the row rather than a fixed 40: the columns
                    // divide the width they are given, which is what keeps the
                    // grid inside its container on a narrow phone and lets the
                    // tint band run unbroken from one end of a range to the
                    // other. The circle inside stays its own fixed size.
                    flex: 1,
                    height: CELL,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: banded ? theme.color.brandSoft : 'transparent',
                    borderRadius: banded ? 0 : theme.radius.md,
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
                      width: CELL - 6,
                      height: CELL - 6,
                      borderRadius: (CELL - 6) / 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isEnd ? theme.color.brand : 'transparent',
                      // Today keeps a quiet ring when it is not itself an end of
                      // the range, so a calendar that can page anywhere still
                      // says where now is.
                      borderWidth: !isEnd && sameDay(d, today) ? 1 : 0,
                      borderColor: theme.color.brand,
                    }}
                  >
                    <Text
                      variant="body"
                      style={{
                        color: isEnd
                          ? theme.color.onBrand
                          : disabled
                            ? theme.color.textFaint
                            : theme.color.text,
                        fontWeight: isEnd ? '700' : '500',
                      }}
                    >
                      {format.day(d.getDate())}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Row>
        ))}
      </View>
    </View>
  );
}
