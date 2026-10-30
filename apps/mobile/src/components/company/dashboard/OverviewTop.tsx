/**
 * The top of the company Overview, as drawn in the owner's mockup: today's attendance card (with its
 * own date pill), then the money cards, then today's tasks beside the urgent escalations.
 * Owners see everyone, a manager only their team. Waves records; it never moves money.
 */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, View } from 'react-native';

import { iconSize, Sheet, Text, useTheme } from '@waves/ui';

import {
  IconDisc,
  RED,
  Skeleton,
  TintCard,
  YELLOW,
} from '@/components/company/dashboard/overviewKit';
import { TasksAndUrgent } from '@/components/company/dashboard/OverviewTasks';
import { GREEN } from '@/components/company/dashboard/parts';
import { StandardCard } from '@/components/standard';
import { useOverview } from '@/data/companyOverview';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { dateFrom, isoDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { attendanceSegments, pct, type AttendanceKey } from '@/lib/overviewMath';

export function OverviewTop({
  groupId,
  afterAttendanceCard,
  afterTasks,
}: {
  groupId: string;
  /** Owner's money cards: they sit right under the attendance card. */
  afterAttendanceCard?: ReactNode;
  /** Upcoming row: it follows the tasks and urgent cards. */
  afterTasks?: ReactNode;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const today = todayIso();
  // The date belongs to the attendance card alone; it is never after today (the clock may cross midnight).
  const [picked, setPicked] = useState(today);
  const [picking, setPicking] = useState(false);
  const day = picked > today ? today : picked;
  const o = useOverview(groupId, day);
  const attendanceRoute = `/group/${groupId}/company-attendance?date=${day}`;

  if (!o.ready)
    return (
      <View style={{ gap: theme.spacing.md }} accessibilityLabel={t.common.loading}>
        <Skeleton height={132} style={{ marginTop: -28 }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={116} flex={1} />
          ))}
        </View>
        <Skeleton height={190} />
      </View>
    );

  // No employees: an invite card in place of attendance and tasks; money and what is coming up still show.
  if (o.people.length === 0)
    return (
      <>
        <TintCard
          ink={theme.color.brand}
          style={{ alignItems: 'center', gap: 8, padding: 20, marginTop: -28 }}
        >
          <IconDisc ink={theme.color.brand} size={48}>
            <Ionicons name="person-add-outline" size={iconSize.lg} color={theme.color.brand} />
          </IconDisc>
          <Text variant="title" align="center">
            {t.company.ovEmptyTitle}
          </Text>
          <Text variant="caption" tone="muted" align="center">
            {t.company.ovEmptyBody}
          </Text>
          {o.isOwner && !o.suspended ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/group/${groupId}/invite`)}
              style={{
                marginTop: 4,
                paddingHorizontal: 18,
                height: 42,
                borderRadius: 14,
                justifyContent: 'center',
                backgroundColor: theme.color.brand,
              }}
            >
              <Text style={{ color: theme.color.onBrand, fontWeight: '700' }}>
                {t.company.qaInvite}
              </Text>
            </Pressable>
          ) : null}
        </TintCard>
        {afterAttendanceCard}
        {afterTasks}
      </>
    );

  const total = o.people.length;
  // With leave in play "not marked" turns grey and leave takes the amber; otherwise as the mockup draws it.
  const color: Record<AttendanceKey, string> = {
    present: GREEN,
    leave: YELLOW,
    unmarked: o.hasLeave ? theme.color.textMuted : YELLOW,
    absent: RED,
  };
  const label: Record<AttendanceKey, string> = {
    present: t.company.overviewPresent,
    leave: t.company.overviewOnLeave,
    unmarked: t.company.overviewUnmarked,
    absent: t.company.overviewAbsent,
  };
  const segments = attendanceSegments(o.counts);
  const legend = (['present', 'leave', 'unmarked', 'absent'] as const)
    .filter((k) => k === 'present' || o.counts[k] > 0)
    .map((k) => ({ key: k, label: label[k], color: color[k], n: o.counts[k] }));
  const percent = pct(o.counts.present, total);
  const title = day === today ? t.company.ovAttendanceToday : t.company.ovAttendance;
  const dateText = dateFrom(day).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${dateText}: ${legend.map((l) => `${l.label} ${l.n}`).join(', ')}`}
        onPress={() => router.push(attendanceRoute)}
        style={{ marginTop: -28 }}
      >
        <StandardCard
          style={{ paddingHorizontal: 14, paddingVertical: 14, borderRadius: 22, gap: 12 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text
              variant="title"
              numberOfLines={2}
              style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: '700' }}
            >
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t.company.ovPickDate}: ${dateText}`}
              onPress={() => setPicking(true)}
              hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}
            >
              <Ionicons name="calendar-outline" size={iconSize.base} color={theme.color.brand} />
              <Text
                variant="caption"
                numberOfLines={1}
                style={{ fontSize: 14, color: theme.color.textMuted, flexShrink: 1 }}
              >
                {dateText}
              </Text>
              <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                flex: 1,
                minWidth: 0,
                flexDirection: 'row',
                height: 14,
                borderRadius: 7,
                overflow: 'hidden',
                backgroundColor: theme.color.surfaceMuted,
              }}
            >
              {segments.map((s, i) => (
                <View
                  key={s.key}
                  style={{
                    flex: s.n,
                    backgroundColor: color[s.key],
                    marginStart: i > 0 ? 1 : 0,
                  }}
                />
              ))}
            </View>
            <View style={{ alignItems: 'flex-end', flexShrink: 0, maxWidth: '40%' }}>
              <Text
                variant="title"
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ fontSize: 22, fontWeight: '800' }}
              >
                {`${o.counts.present} / ${total}`}
              </Text>
              <Text variant="micro" tone="muted" numberOfLines={1}>
                {t.company.ovPresentPct.replace('{pct}', percent === null ? '—' : String(percent))}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 }}>
            {legend.map((l) => (
              <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View
                  style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: l.color }}
                />
                <Text variant="caption" tone="muted">
                  {l.label}
                </Text>
                <Text variant="caption" style={{ fontWeight: '700', color: theme.color.text }}>
                  {l.n}
                </Text>
              </View>
            ))}
          </View>
        </StandardCard>
      </Pressable>

      {afterAttendanceCard}

      <TasksAndUrgent groupId={groupId} o={o} />

      {afterTasks}

      <Sheet
        visible={picking}
        onClose={() => setPicking(false)}
        closeLabel={t.common.close}
        title={t.company.ovPickDate}
      >
        <DateTimePicker
          value={dateFrom(day)}
          maximumDate={dateFrom(today)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_, d) => {
            setPicking(false);
            if (d) setPicked(isoDate(d) > today ? today : isoDate(d));
          }}
        />
      </Sheet>
    </>
  );
}
