/**
 * The Activity feed's date-range filter — quick presets over one inline range
 * calendar.
 *
 * The whole feed is already on the phone (the mirror), so narrowing it is a pure
 * cut on the loaded rows; this component only gathers the range and hands it
 * back. The old design paired a From and a To field that each opened a native
 * date-picker modal — open, pick, dismiss, open, pick, dismiss, Apply — four
 * taps before a single-day filter was even set. This is the pattern the industry
 * settled on instead (Monzo, Spotify, StubHub): a row of one-tap presets for the
 * common ranges, and a single always-visible {@link RangeCalendar} for a custom
 * one (tap the start day, tap the end day). A preset applies and closes on the
 * one tap; a custom range is committed on Apply so the feed behind the sheet does
 * not flicker as the two ends are chosen.
 *
 * Everything is clamped to the feed's own span (`earliest`/`latest`) — a day
 * before the first event or after the last cannot be chosen.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Row, Sheet, Text, useTheme } from '@waves/ui';

import { RangeCalendar } from '@/components/RangeCalendar';
import { useStrings } from '@/i18n';
import { gregorianFormatter } from '@/lib/calendarGrid';

/** A committed filter range — both ends are calendar-day anchors (local noon). */
export interface DateRange {
  start: Date;
  end: Date;
}

/** A calendar day at local noon — the anchor the whole control works in. */
function dayNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0, 0);
}

export function ActivityDateFilter({
  earliest,
  latest,
  locale,
  initial,
  onApply,
  onClear,
  onClose,
}: {
  /** The feed's own start and end — the picker is clamped to this span. */
  earliest: Date;
  latest: Date;
  locale: string;
  /** The range already in force, so reopening the sheet shows it. */
  initial: DateRange | null;
  onApply: (range: DateRange) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [start, setStart] = useState<Date | null>(initial?.start ?? null);
  const [end, setEnd] = useState<Date | null>(initial?.end ?? null);

  const lo = dayNoon(earliest);
  const hi = dayNoon(latest);
  const clamp = (d: Date): Date => {
    const day = dayNoon(d);
    if (day.getTime() < lo.getTime()) return lo;
    if (day.getTime() > hi.getTime()) return hi;
    return day;
  };

  // The presets, relative to today but clamped into the feed's span, so a feed
  // that ends before today still yields a sensible (collapsed) range.
  const now = new Date();
  const presets: { label: string; start: Date; end: Date }[] = [
    { label: t.activityFilter.today, start: clamp(now), end: clamp(now) },
    { label: t.activityFilter.last7, start: clamp(addDays(now, -6)), end: clamp(now) },
    { label: t.activityFilter.last30, start: clamp(addDays(now, -29)), end: clamp(now) },
    {
      label: t.activityFilter.thisMonth,
      start: clamp(new Date(now.getFullYear(), now.getMonth(), 1, 12)),
      end: clamp(now),
    },
  ];

  // Pinned to the Gregorian calendar for the same reason the grid below it is:
  // `ar-SA` resolves to Umm al-Qura by default, and a read-out naming a Hijri
  // month over a calendar drawn in Gregorian ones contradicts the thing it is
  // meant to echo. The language, and its digits, are still the reader's.
  const readable = gregorianFormatter(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const showDate = (value: Date | null): string =>
    value ? (readable?.format(value) ?? value.toDateString()) : t.pickers.notSet;

  // A preset is a one-tap answer: commit it and close, no Apply needed.
  const applyPreset = (p: { start: Date; end: Date }): void => {
    onApply({ start: p.start, end: p.end });
    onClose();
  };

  const activePreset = (p: { start: Date; end: Date }): boolean =>
    start !== null &&
    end !== null &&
    start.getTime() === p.start.getTime() &&
    end.getTime() === p.end.getTime();

  return (
    /* A real Modal (`Sheet`), not an in-tree overlay. The bottom bar is
       rendered once at the root over the whole stack, so a sheet drawn inside
       this screen is painted *under* it: the calendar's last rows and the
       Apply/Clear pair ended up behind the bar, with the bar's own white
       surface reading as a second box over the sheet's. A modal is its own
       window above everything the app has drawn, so the only thing left below
       the sheet is the system navigation bar — which `Sheet` already leaves a
       foot for. */
    <Sheet visible onClose={onClose} closeLabel={t.common.close} style={{ maxHeight: '90%' }}>
      {/* Nothing in this sheet scrolls, in either direction, and that is the
          fix rather than a preference. The calendar used to sit in a vertical
          ScrollView: on Android a scroller cancels a child's press the moment
          the finger drifts a pixel or two, so a tap on a day drew its ripple
          and then went nowhere — "From · Not set" however many days you tapped.
          The picker was unusable, and the cause was invisible, because the
          ripple says the tap was seen.

          A month is a known size. Six week rows, a header, a chip row and two
          buttons fit a phone with room to spare, so the sheet is laid out to
          fit and every tap in it reaches what it was aimed at. */}
      <View style={{ gap: theme.spacing.lg, flexShrink: 1 }}>
        <Text variant="heading">{t.activityFilter.open}</Text>

        <View style={{ gap: theme.spacing.lg, flexShrink: 1 }}>
          {/* One-tap presets — the common ranges, applied immediately. Wrapped
              rather than scrolled sideways: four chips do not fit one line on a
              narrow phone, and the fourth used to be sliced in half by the
              card's edge, which reads as a broken layout rather than as "there
              is more this way". A second line costs 40pt and shows all four. */}
          <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {presets.map((p) => {
              const active = activePreset(p);
              return (
                <Pressable
                  key={p.label}
                  accessibilityRole="button"
                  accessibilityLabel={p.label}
                  accessibilityState={{ selected: active }}
                  onPress={() => applyPreset(p)}
                  style={({ pressed }) => ({
                    paddingVertical: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.pill,
                    borderWidth: 1,
                    borderColor: active ? theme.color.brand : theme.color.border,
                    backgroundColor: active ? theme.color.brandSoft : theme.color.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text
                    variant="caption"
                    style={{
                      color: active ? theme.color.brand : theme.color.text,
                      fontWeight: '600',
                    }}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>

          {/* The selected range, read-only — it echoes the calendar taps below.

            Both halves shrink and truncate rather than push each other about:
            the dates are formatted long ("Sat, 12 Sept") in the reader's own
            language, and a Tamil or Arabic month name at a large font scale can
            outrun half a phone. Without this the trailing half was shoved past
            the card's padding and clipped at the screen edge — the leading one
            keeping its gutter, which is what makes the row look lopsided rather
            than full. */}
          <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {t.activityFilter.from} · {showDate(start)}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {t.activityFilter.to} · {showDate(end ?? start)}
            </Text>
          </Row>

          {/* One inline calendar: tap the start day, then the end day. */}
          <RangeCalendar
            earliest={earliest}
            latest={latest}
            locale={locale}
            start={start}
            end={end}
            onSelect={(s, e) => {
              setStart(s);
              setEnd(e);
            }}
          />
        </View>

        <Row style={{ gap: theme.spacing.sm }}>
          {initial || start ? (
            <View style={{ flex: 1 }}>
              <Button
                label={t.activityFilter.clear}
                variant="secondary"
                fullWidth
                onPress={() => {
                  onClear();
                  onClose();
                }}
              />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Button
              label={t.activityFilter.apply}
              disabled={!start}
              fullWidth
              onPress={() => {
                if (!start) return;
                // The sheet orders the two ends, so an end-first pick is valid.
                const a = start;
                const b = end ?? start;
                onApply(a <= b ? { start: a, end: b } : { start: b, end: a });
                onClose();
              }}
            />
          </View>
        </Row>
      </View>
    </Sheet>
  );
}
