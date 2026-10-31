import { Pressable, View } from 'react-native';
import { Text, useTheme } from '@waves/ui';
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
}: {
  year: number;
  month: number;
  items: readonly CalendarItem[];
  selectedDay: string | null;
  onSelect: (day: string) => void;
  onMonthChange: (year: number, month: number) => void;
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
          accessibilityLabel={t.calendar.title}
          onPress={() => move(-1)}
        >
          <Text variant="heading">‹</Text>
        </Pressable>
        <Text variant="body">{monthTitle}</Text>
        <Pressable accessibilityRole="button" onPress={() => move(1)}>
          <Text variant="heading">›</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: 7 }, (_, i) => (
          <View
            key={`weekday-${i}`}
            style={{ width: '14.2857%', alignItems: 'center', paddingBottom: theme.spacing.xs }}
          >
            <Text variant="micro" tone="muted">
              {new Date(Date.UTC(2026, 0, 4 + i)).toLocaleDateString(locale, {
                weekday: 'narrow',
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
          const selected = day === selectedDay;
          return (
            <Pressable
              key={`day-${i}`}
              disabled={!day}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => day && onSelect(day)}
              style={{ width: '14.2857%', minHeight: 46, alignItems: 'center', paddingTop: 3 }}
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
                  style={{ color: selected ? theme.color.onBrand : theme.color.text }}
                >
                  {day ? n : ''}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 2, height: 6 }}>
                {kinds.map((kind) => (
                  <View
                    key={kind}
                    style={{ width: 4, height: 4, borderRadius: 3, backgroundColor: colors[kind] }}
                  />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
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
    </StandardCard>
  );
}
