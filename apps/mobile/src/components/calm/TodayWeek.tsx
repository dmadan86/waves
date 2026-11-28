/** The Today week strip and its one summary line; shared by Personal Today and a space's Home. */

import { View } from 'react-native';

import { useTheme } from '@waves/ui';

import { SummaryLine } from '@/components/calm/SummaryLine';
import { WeekStrip } from '@/components/calm/WeekStrip';
import { fill, useStrings } from '@/i18n';
import { weekDays, weekSummary } from '@/lib/calm/weekPace';
import { WEEK_START } from '@/lib/calendarGrid';
import { dateTimeFormat } from '@/lib/dateTimeFormat';

export function TodayWeek({
  today,
  currency,
  spent,
  pace,
  dueDates,
  fmt,
}: {
  today: string;
  currency: string;
  /** Spend per ISO date of the week. */
  spent: Readonly<Record<string, bigint>>;
  /** One day's budget, or null with no budget. */
  pace: bigint | null;
  dueDates: ReadonlySet<string>;
  fmt: (minor: bigint, currency: string) => string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const c = t.calm;
  const days = weekDays({ today, weekStart: WEEK_START, spent, pace, dueDates });
  const week = weekSummary(days, pace);
  const letter = (weekday: number): string =>
    dateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 10, 22 + weekday)),
    );
  const longDay = (iso: string): string =>
    dateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));
  return (
    <View style={{ gap: theme.spacing.md }}>
      <WeekStrip
        days={days}
        weekdayLetter={letter}
        dayLabel={(d) => `${longDay(d.date)}, ${fmt(d.spent, currency)}`}
      />
      <SummaryLine
        text={fill(c.weekSpent, { amount: fmt(week.spent, currency) })}
        verdict={week.verdict === null ? null : week.verdict === 'onTrack' ? c.onTrack : c.overPace}
        warn={week.verdict === 'overPace'}
      />
    </View>
  );
}
