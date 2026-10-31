/** One employee's attendance month: a dot per day by status, counts, and (full) the list of marks. */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { StandardCard } from '@/components/standard';
import { useCalendar } from '@/data/companyCalendar';
import { useAttendance, type AttendanceStatus } from '@/data/companyWorkday';
import { monthCounts, shiftMonth } from '@/data/employeeDetail';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { showDate } from '@/lib/expenseDay';

export function AttendanceMonth({
  groupId,
  memberId,
  onViewAll,
  list = false,
  month: controlled,
  onMonth,
}: {
  groupId: string;
  memberId: string;
  /** Overview card: shows the "View full attendance" button. */
  onViewAll?: () => void;
  /** Attendance tab: also lists every mark of the month. */
  list?: boolean;
  /** YYYY-MM kept by the parent so the Overview and Attendance tabs show the same month. */
  month?: string;
  onMonth?: (month: string) => void;
}) {
  const { t, locale } = useStrings();
  const theme = useTheme();
  const marks = useAttendance(groupId);
  const calendar = useCalendar(groupId);
  const today = todayIso();
  const [own, setOwn] = useState(today.slice(0, 7));
  const month = controlled ?? own;
  const setMonth = onMonth ?? setOwn;
  const first = new Date(`${month}-01T00:00:00Z`);
  const counts = monthCounts(marks, memberId, month);
  const monthName = first.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const statusLabel = (s: AttendanceStatus | undefined): string =>
    s === 'present'
      ? t.company.attendancePresent
      : s === 'half'
        ? t.company.attHalfDay
        : s === 'absent'
          ? t.company.attendanceAbsent
          : '';
  const statusColor = (s: AttendanceStatus | undefined): string | undefined =>
    s === 'present'
      ? theme.color.positive
      : s === 'half'
        ? theme.color.warning
        : s === 'absent'
          ? theme.color.negative
          : undefined;
  const nav = (n: number, label: string, icon: 'chevron-back' | 'chevron-forward', off = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      hitSlop={6}
      onPress={() => setMonth(shiftMonth(month, n))}
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.brandSoft,
        opacity: off ? 0.4 : 1,
      }}
    >
      <Ionicons name={directionalIcon(icon)} size={iconSize.base} color={theme.color.brand} />
    </Pressable>
  );
  const legend = [
    { status: 'present', n: counts.present },
    { status: 'half', n: counts.half },
    { status: 'absent', n: counts.absent },
  ] as const;
  const marked = Array.from({ length: counts.daysInMonth }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { day, status: marks.get(`${memberId}|${day}`)?.status };
  }).filter((row) => row.status);
  const presentDays = counts.present + counts.half / 2;

  return (
    <StandardCard style={{ gap: theme.spacing.sm, padding: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="calendar-outline" size={iconSize.md} color={theme.color.brand} />
        <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '700' }}>
          {t.company.attendanceTitle}
        </Text>
        <View style={{ flex: 1 }} />
        {nav(-1, t.company.attendancePreviousMonth, 'chevron-back')}
        <Text variant="caption" numberOfLines={1} adjustsFontSizeToFit style={{ maxWidth: 120 }}>
          {monthName}
        </Text>
        {nav(1, t.company.attendanceNextMonth, 'chevron-forward', month >= today.slice(0, 7))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: 7 }, (_, i) => (
          <View key={`weekday-${i}`} style={{ width: '14.2857%', alignItems: 'center' }}>
            <Text variant="micro" tone="muted">
              {new Date(Date.UTC(2026, 0, 4 + i)).toLocaleDateString(locale, {
                weekday: 'narrow',
                timeZone: 'UTC',
              })}
            </Text>
          </View>
        ))}
        {Array.from({ length: first.getUTCDay() + counts.daysInMonth }, (_, i) => {
          const day = i - first.getUTCDay() + 1;
          const date = day > 0 ? `${month}-${String(day).padStart(2, '0')}` : '';
          const status = date ? marks.get(`${memberId}|${date}`)?.status : undefined;
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
          return (
            <View
              key={i}
              accessible={day > 0}
              accessibilityLabel={`${day} ${statusLabel(status)}${holiday ? `, ${t.calendar.holidayOnDay.replace('{name}', holiday.name)}` : ''}${onLeave ? `, ${t.calendar.leaveOnDay}` : ''}`}
              style={{ width: '14.2857%', minHeight: 36, alignItems: 'center', gap: 2 }}
            >
              <Text variant="caption" tone="muted">
                {day > 0 ? day : ''}
              </Text>
              {day > 0 ? (
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    borderWidth: 1,
                    borderColor: holiday ? theme.color.warning : theme.color.border,
                    backgroundColor:
                      statusColor(status) ?? (onLeave ? theme.color.brand : 'transparent'),
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </View>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm }}
      >
        {legend.map((item) => (
          <View
            key={item.status}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: statusColor(item.status),
              }}
            />
            <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {statusLabel(item.status)}
            </Text>
            <Text variant="micro" style={{ fontWeight: '700' }}>
              {item.n}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="caption" tone="muted">
        {fill(t.company.daysPresentIn, { n: String(presentDays), month: monthName })}
      </Text>
      {list && marked.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          {marked.map((row) => (
            <View
              key={row.day}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: statusColor(row.status),
                }}
              />
              <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                {showDate(row.day, locale)}
              </Text>
              <Text variant="caption" tone="muted">
                {statusLabel(row.status)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {onViewAll ? (
        <Pressable
          accessibilityRole="button"
          onPress={onViewAll}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            minHeight: 40,
            borderRadius: theme.radius.pill,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
            {t.company.viewFullAttendance}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={theme.color.brand}
          />
        </Pressable>
      ) : null}
    </StandardCard>
  );
}
