import { useState } from 'react';
import { View } from 'react-native';
import { attendanceDaysText } from '@waves/core';
import { Button, Text, useTheme } from '@waves/ui';
import { SectionHeader, StandardCard } from '@/components/standard';
import { useAttendance } from '@/data/companyWorkday';
import { useCalendar } from '@/data/companyCalendar';
import { todayIso } from '@/data/personal';
import { plural, useStrings } from '@/i18n';

export function AttendanceMonth({ groupId, memberId }: { groupId: string; memberId: string }) {
  const { t, locale } = useStrings();
  const theme = useTheme();
  const marks = useAttendance(groupId);
  const calendar = useCalendar(groupId);
  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const first = new Date(`${month}-01T00:00:00Z`);
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const move = (n: number) => {
    const date = new Date(first);
    date.setUTCMonth(date.getUTCMonth() + n);
    setMonth(date.toISOString().slice(0, 7));
  };
  return (
    <StandardCard style={{ gap: theme.spacing.sm }}>
      <SectionHeader title={t.company.attendanceTitle} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button
          label="‹"
          accessibilityLabel={t.company.attendancePreviousMonth}
          variant="secondary"
          onPress={() => move(-1)}
        />
        <Text variant="body">
          {first.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })}
        </Text>
        <Button
          label="›"
          accessibilityLabel={t.company.attendanceNextMonth}
          variant="secondary"
          disabled={month >= today.slice(0, 7)}
          onPress={() => move(1)}
        />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: 7 }, (_, i) => (
          <View
            key={`weekday-${i}`}
            style={{ width: '14.2857%', alignItems: 'center', paddingBottom: theme.spacing.sm }}
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
          const day = i - first.getUTCDay() + 1;
          const status =
            day > 0
              ? marks.get(`${memberId}|${month}-${String(day).padStart(2, '0')}`)?.status
              : undefined;
          const date = day > 0 ? `${month}-${String(day).padStart(2, '0')}` : '';
          const holiday = date
            ? calendar.holidays.find((item) => item.startDay <= date && item.endDay >= date)
            : undefined;
          const onLeave = date
            ? calendar.leave.some(
                (item) =>
                  item.memberId === memberId &&
                  item.status === 'approved' &&
                  item.startDay <= date &&
                  item.endDay >= date,
              )
            : false;
          const label =
            status === 'present'
              ? t.company.attendancePresent
              : status === 'half'
                ? t.company.attendanceHalf
                : status === 'absent'
                  ? t.company.attendanceAbsent
                  : '';
          return (
            <View
              key={i}
              accessible={day > 0}
              accessibilityLabel={`${day} ${label}${holiday ? `, ${t.calendar.holidayOnDay.replace('{name}', holiday.name)}` : ''}${onLeave ? `, ${t.calendar.leaveOnDay}` : ''}`}
              style={{ width: '14.2857%', minHeight: 42, alignItems: 'center', gap: 4 }}
            >
              <Text variant="caption" tone="muted">
                {day > 0 ? day : ''}
              </Text>
              {holiday ? (
                <Text variant="micro" numberOfLines={1} style={{ color: theme.color.warning }}>
                  ⚑
                </Text>
              ) : null}
              {onLeave ? (
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: theme.color.brand,
                  }}
                />
              ) : null}
              {day > 0 ? (
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    borderWidth: 1,
                    borderColor: theme.color.border,
                    backgroundColor:
                      status === 'present'
                        ? theme.color.positive
                        : status === 'half'
                          ? theme.color.warning
                          : status === 'absent'
                            ? theme.color.negative
                            : 'transparent',
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {[
          { label: t.company.attendancePresent, color: theme.color.positive },
          { label: t.company.attendanceHalf, color: theme.color.warning },
          { label: t.company.attendanceAbsent, color: theme.color.negative },
        ].map((item) => (
          <View
            key={item.label}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}
          >
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: item.color }} />
            <Text variant="micro" tone="muted">
              {item.label}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="caption" tone="muted">
        {plural(
          locale,
          Number(
            attendanceDaysText(marks.values(), memberId, `${month}-01`, `${month}-${count}`) || '0',
          ),
          t.company.attendanceSummary,
        )}
      </Text>
    </StandardCard>
  );
}
