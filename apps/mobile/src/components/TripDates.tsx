/**
 * When the trip is — its start and end, chosen on one calendar.
 *
 * The span is worth recording on its own: it labels the group with its dates
 * and marks how long the shared ledger was meant to cover. The daily-reminder
 * controls that used to live here were removed, so this card now only asks the
 * two dates; the underlying `remind_*` fields stay on the type for whatever
 * else reads them, but nothing here sets them.
 *
 * It used to ask for them one at a time: a Starts field that opened the native
 * date picker, a scroll, a confirm, then the same again for Ends — four or more
 * interactions to express a single idea ("we are away from the 4th to the
 * 11th"), and never once a view of both ends together. Every travel app settled
 * on the other shape years ago — Airbnb, Booking.com, Vrbo, Agoda, Wanderlog
 * all show one calendar, take the start on the first tap and the end on the
 * second, and tint the days in between — so that is what this is now. The two
 * fields survive as a read-out rather than as two doors: they show the start the
 * moment it is picked, which is the whole point of picking on one surface.
 *
 * Nothing is written until both ends are known. A half-chosen range is a local
 * draft, so walking away mid-selection leaves the stored dates exactly as they
 * were, and a completed range is one save rather than two.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Card, directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { RangeCalendar } from '@/components/RangeCalendar';
import { plural, useStrings } from '@/i18n';
import { gregorianFormatter } from '@/lib/calendarGrid';
import { inclusiveTripDays, tripDateFromIso, tripDateRangePatch } from '@/lib/tripDateRange';

/**
 * Only the fields this card reads and writes — not a whole `GroupRow`. A saved
 * group satisfies it structurally, and so does the local state of a group being
 * created, which is what lets the create screen reuse this editor before there
 * is a group to point at.
 */
export interface TripDatesValue {
  start_date: string | null;
  end_date: string | null;
  time_zone: string;
  remind_daily: boolean;
  remind_morning_at: string;
  remind_evening_at: string;
}

export interface TripDatesPatch {
  start_date?: string | null;
  end_date?: string | null;
  time_zone?: string;
  remind_daily?: boolean;
  remind_morning_at?: string;
  remind_evening_at?: string;
}

/**
 * One end of the range as it reads back — its own half of a single framed
 * strip, a small label over the date. `active` marks the end the next tap on
 * the calendar will set, so while the end is being chosen the start stays on
 * screen, plainly filled in, and it is obvious which half is listening.
 */
function RangeEnd({
  label,
  value,
  set,
  active,
  align,
  onPress,
}: {
  label: string;
  value: string;
  set: boolean;
  active: boolean;
  /** Which way the half reads — `end` puts the "Ends" half against the far
   *  edge. Both are direction-relative, so the pair mirrors under RTL. */
  align: 'start' | 'end';
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        gap: 2,
        alignItems: align === 'end' ? 'flex-end' : 'flex-start',
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radius.md,
        backgroundColor: active ? theme.color.brandSoft : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text
        variant="subheading"
        style={{
          fontWeight: '700',
          color: set ? theme.color.text : theme.color.textMuted,
        }}
      >
        {value}
      </Text>
    </Pressable>
  );
}

export function TripDates({
  group,
  locale,
  onChange,
  embedded = false,
}: {
  group: TripDatesValue;
  locale: string;
  onChange: (patch: TripDatesPatch) => void;
  /**
   * Drop the outer card and the title/info header, and keep the calendar
   * unfolded — for when this editor is opened inside a row of a bigger card
   * that already carries the "Dates" label and has already asked for it.
   */
  embedded?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  // The why-does-this-exist paragraph is long, and once you have read it once
  // you do not need it every time you open settings. Folded behind the info
  // icon by default; the dates themselves stay in view.
  const [showInfo, setShowInfo] = useState(false);
  // Whether the calendar is on screen. Embedded, the host row has already made
  // that decision by unfolding this editor at all.
  const [open, setOpen] = useState(embedded);
  /**
   * The start of a range being chosen, held here rather than saved.
   *
   * Non-null means exactly one thing: the next tap on the calendar closes the
   * range. That covers both ways of getting there — a fresh first tap, and
   * tapping the "Ends" half of the strip to move only the end of a range that
   * is already stored — so the calendar needs no mode of its own.
   */
  const [pendingStart, setPendingStart] = useState<Date | null>(null);

  const savedStart = tripDateFromIso(group.start_date);
  const savedEnd = tripDateFromIso(group.end_date);
  // Mid-selection the strip and the grid show the draft: the pending start on
  // its own, with the end blank and waiting.
  const shownStart = pendingStart ?? savedStart;
  const shownEnd = pendingStart ? null : savedEnd;

  // The same Gregorian pinning the grid uses, so the read-out cannot name a
  // Hijri month over a Gregorian calendar. Built once per language.
  const readable = useMemo(() => {
    const fmt = gregorianFormatter(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    return (value: Date | null): string =>
      value ? (fmt?.format(value) ?? value.toDateString()) : t.pickers.notSet;
  }, [locale, t]);

  const commit = (a: Date, b: Date): void => {
    // Whichever way round they were tapped, the earlier day is the start. That
    // is why an end before a start is not something this control has to refuse:
    // it cannot be expressed.
    onChange(tripDateRangePatch(a, b, group.time_zone));
    setPendingStart(null);
    // The range is saved and the strip above now reads it back, so there is
    // nothing left to confirm; folding the calendar away is the confirmation.
    // Embedded, folding is the host row's business, not ours.
    if (!embedded) setOpen(false);
  };

  const body = (
    <>
      {embedded ? null : (
        <View style={{ gap: theme.spacing.xs }}>
          <Row style={{ justifyContent: 'space-between', gap: theme.spacing.sm }}>
            <Text variant="subheading">{t.misc.tripDatesTitle}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showInfo }}
              accessibilityLabel={t.misc.aboutTripDates}
              hitSlop={8}
              onPress={() => setShowInfo((shown) => !shown)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons
                name={showInfo ? 'information-circle' : 'information-circle-outline'}
                size={iconSize.lg}
                color={showInfo ? theme.color.brand : theme.color.textFaint}
              />
            </Pressable>
          </Row>
          {showInfo ? (
            <Text variant="caption" tone="muted">
              {t.misc.tripDatesBody}
            </Text>
          ) : null}
        </View>
      )}

      {/* The range as one framed strip rather than two doors: start, arrow, end.
          Closed, tapping anywhere on it opens the calendar. Open, each half says
          which end the next tap sets — so the end can be moved on its own
          without re-picking the start. */}
      <Row
        style={{
          alignItems: 'center',
          gap: theme.spacing.xs,
          padding: theme.spacing.xs,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: open ? theme.color.brand : theme.color.border,
          backgroundColor: theme.color.surface,
        }}
      >
        <RangeEnd
          label={t.pickers.starts}
          value={readable(shownStart)}
          set={shownStart !== null}
          active={open && pendingStart === null}
          align="start"
          onPress={() => {
            setPendingStart(null);
            setOpen(true);
          }}
        />
        {/* The arrow means "onward", so it is content, not layout: React Native
            mirrors the row for Arabic but would leave this glyph pointing the
            way it was drawn. `directionalIcon` is what flips it. */}
        <Ionicons
          name={directionalIcon('arrow-forward')}
          size={iconSize.sm}
          color={theme.color.textFaint}
        />
        <RangeEnd
          label={t.pickers.ends}
          // Mid-selection this half is the instruction, not a blank: it says
          // what the next tap will do while the start sits filled in beside it.
          value={pendingStart ? t.pickers.pickEnd : readable(shownEnd)}
          set={shownEnd !== null}
          active={open && pendingStart !== null}
          align="end"
          onPress={() => {
            // Only meaningful once there is a start to keep — otherwise this is
            // the same request as tapping the other half.
            setPendingStart(savedStart);
            setOpen(true);
          }}
        />
      </Row>

      {open ? (
        <RangeCalendar
          locale={locale}
          start={shownStart}
          end={shownEnd}
          onSelect={(from, to) => {
            // A null `to` is the first of the two taps: hold it and wait.
            if (!from) return;
            if (!to) {
              setPendingStart(from);
              return;
            }
            commit(from, to);
          }}
        />
      ) : null}

      {/* How long the trip is, and a quiet way out — a small muted link rather
          than a button competing with the calendar above it. */}
      {savedStart && savedEnd && !pendingStart ? (
        <Row style={{ alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md }}>
          <Text variant="caption" tone="muted">
            {plural(locale, inclusiveTripDays(savedStart, savedEnd), t.pickers.dayCount)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.pickers.clearDates}
            onPress={() => {
              setPendingStart(null);
              onChange({ start_date: null, end_date: null });
            }}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              <Ionicons
                name="close-circle-outline"
                size={iconSize.sm}
                color={theme.color.textMuted}
              />
              <Text variant="caption" tone="muted">
                {t.pickers.clearDates}
              </Text>
            </Row>
          </Pressable>
        </Row>
      ) : null}
    </>
  );

  if (embedded) return <View style={{ gap: theme.spacing.lg }}>{body}</View>;
  return <Card style={{ gap: theme.spacing.lg }}>{body}</Card>;
}
