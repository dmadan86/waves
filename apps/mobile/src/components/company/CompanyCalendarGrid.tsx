import { Pressable, View } from 'react-native';
import { Text, useTheme } from '@waves/ui';
import { withAlpha } from '@/components/company/dashboard/overviewKit';
import { StandardCard } from '@/components/standard';
import { useStrings } from '@/i18n';
import type { CalendarItem } from '@/data/companyCalendarItems';
import { todayIso } from '@/data/personal';

export function CompanyCalendarGrid({
  year,
  month,
  items,
  selectedDay,
  onSelect,
  onMonthChange,
  dots,
  range,
  isDisabled,
}: {
  year: number;
  month: number;
  items: readonly CalendarItem[];
  selectedDay: string | null;
  onSelect: (day: string) => void;
  onMonthChange: (year: number, month: number) => void;
  /** One dot colour per day (Tasks); replaces the per-kind dots and the legend. */
  dots?: Readonly<Record<string, string>>;
  /** Highlight a start..end range (filled ends, soft fill between) instead of a single selected day. */
  range?: { start: string; end: string };
  /** Days that cannot be tapped (dimmed). */
  isDisabled?: (day: string) => boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const today = todayIso();
  const first = new Date(Date.UTC(year, month - 1, 1));
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthTitle = first.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const move = (by: number) => {
    const next = new Date(Date.UTC(year, month - 1 + by, 1));
    onMonthChange(next.getUTCFullYear(), next.getUTCMonth() + 1);
  };
  const colors = {
    leave: theme.color.warning,
    money: theme.color.positive,
    work: theme.color.brand,
    birthday: theme.color.negative,
  };
  const labels = [
    t.calendar.filterLeave,
    t.calendar.filterMoney,
    t.calendar.filterWork,
    t.calendar.filterBirthdays,
  ];
  return (
    <StandardCard style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.personal.prevMonth}
          onPress={() => move(-1)}
        >
          <Text variant="heading">‹</Text>
        </Pressable>
        <Text variant="body" style={{ fontWeight: '700' }}>
          {monthTitle} ▾
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.personal.nextMonth}
          onPress={() => move(1)}
        >
          <Text variant="heading">›</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: 7 }, (_, i) => (
          <View
            key={`weekday-${i}`}
            style={{ width: '14.2857%', alignItems: 'center', paddingBottom: theme.spacing.xs }}
          >
            <Text
              variant="micro"
              tone="muted"
              style={i === 0 || i === 6 ? { color: theme.color.negative } : undefined}
            >
              {new Date(Date.UTC(2026, 0, 4 + i)).toLocaleDateString(locale, {
                weekday: 'short',
                timeZone: 'UTC',
              })}
            </Text>
          </View>
        ))}
        {Array.from({ length: first.getUTCDay() + count }, (_, i) => {
          const n = i - first.getUTCDay() + 1;
          const day =
            n > 0 ? `${year}-${String(month).padStart(2, '0')}-${String(n).padStart(2, '0')}` : '';
          const kinds = [
            ...new Set(items.filter((item) => item.day === day).map((item) => item.kind)),
          ].slice(0, 4);
          const selected = range ? day === range.start || day === range.end : day === selectedDay;
          const inRange = !!range && !!day && day >= range.start && day <= range.end;
          const off = !!day && !!isDisabled?.(day);
          return (
            <Pressable
              key={`day-${i}`}
              disabled={!day || off}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => day && onSelect(day)}
              style={{
                width: '14.2857%',
                minHeight: 46,
                alignItems: 'center',
                paddingTop: 3,
                opacity: off ? 0.35 : 1,
                backgroundColor: inRange ? withAlpha(theme.color.brand, 0.14) : 'transparent',
              }}
            >
              <View
                style={{
                  width: 29,
                  height: 29,
                  borderRadius: 15,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? theme.color.brand : 'transparent',
                  borderWidth: day === today && !selected ? 1 : 0,
                  borderColor: theme.color.brand,
                }}
              >
                <Text
                  variant="caption"
                  style={{
                    color: selected
                      ? theme.color.onBrand
                      : i % 7 === 0 || i % 7 === 6
                        ? theme.color.negative
                        : theme.color.text,
                  }}
                >
                  {day ? n : ''}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 2, height: 6 }}>
                {dots
                  ? dots[day] && (
                      <View
                        style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: dots[day] }}
                      />
                    )
                  : kinds.map((kind) => (
                      <View
                        key={kind}
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 3,
                          backgroundColor: colors[kind],
                        }}
                      />
                    ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      {dots ? null : (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: theme.spacing.xs,
          }}
        >
          {labels.map((label, i) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: [
                    theme.color.warning,
                    theme.color.positive,
                    theme.color.brand,
                    theme.color.negative,
                  ][i],
                }}
              />
              <Text variant="micro" tone="muted">
                {label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </StandardCard>
  );
}
