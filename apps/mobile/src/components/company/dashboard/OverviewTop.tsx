/**
 * The top of the company Overview, as drawn in the owner's mockup: today's attendance card (with its
 * date in the title), the money cards, then one "needs your attention" list.
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
import { AttentionList } from '@/components/company/dashboard/OverviewTasks';
import { GREEN } from '@/components/company/dashboard/parts';
import { StandardCard } from '@/components/standard';
import { useOverview } from '@/data/companyOverview';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { dateFrom, isoDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { attendanceSegments, attendanceSummary, type AttendanceKey } from '@/lib/overviewMath';

export function OverviewTop({
  groupId,
  compose,
}: {
  groupId: string;
  /** Lays out the cards once they have loaded; `attendance` and `attention` are this file's two. */
  compose: (own: { attendance: ReactNode; attention?: ReactNode; sheet?: ReactNode }) => ReactNode;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const today = todayIso();
  // The date belongs to the attendance card alone; it is never after today (the clock may cross midnight).
  const [picked, setPicked] = useState(today);
  const [picking, setPicking] = useState(false);
  const day = picked > today ? today : picked;
  const o = useOverview(groupId, day);

  if (!o.ready)
    return (
      <View style={{ gap: theme.spacing.md }} accessibilityLabel={t.common.loading}>
        <Skeleton height={170} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[0, 1].map((i) => (
            <Skeleton key={i} height={96} flex={1} />
          ))}
        </View>
        <Skeleton height={150} />
      </View>
    );

  // No employees: an invite card in place of attendance and tasks; money and what is coming up still show.
  if (o.people.length === 0)
    return compose({
      attendance: (
        <TintCard ink={theme.color.brand} style={{ alignItems: 'center', gap: 8, padding: 20 }}>
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
      ),
    });

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
  const summary = attendanceSummary(o.counts);
  const legend = (['present', 'leave', 'unmarked', 'absent'] as const)
    .filter((k) => k === 'present' || o.counts[k] > 0)
    .map((k) => ({ key: k, label: label[k], color: color[k], n: o.counts[k] }));
  const title = day === today ? t.company.ovAttendanceToday : t.company.ovAttendance;
  const dateText = dateFrom(day).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  // Present / pending / absent open the attendance list filtered to that mark; leave has no mark to filter by.
  const open = (status?: AttendanceKey) =>
    router.push(
      `/group/${groupId}/company-attendance?date=${day}${status && status !== 'leave' ? `&status=${status}` : ''}`,
    );

  const attendance = (
    <StandardCard style={{ paddingHorizontal: 14, paddingVertical: 14, borderRadius: 22, gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t.company.ovPickDate}: ${title}, ${dateText}`}
        onPress={() => setPicking(true)}
        hitSlop={8}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        <Text variant="title" style={{ flexShrink: 1, fontSize: 17, fontWeight: '700' }}>
          {`${title} — ${dateText}`}
        </Text>
        <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.brand} />
      </Pressable>
      <Text variant="title" style={{ fontSize: 22, fontWeight: '800' }}>
        {fill(t.company.ovPresentOf, { n: summary.present, total: summary.total })}
      </Text>
      <View
        accessibilityElementsHidden
        style={{
          flexDirection: 'row',
          height: 12,
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: theme.color.surfaceMuted,
        }}
      >
        {segments.map((s, i) => (
          <View
            key={s.key}
            style={{ flex: s.n, backgroundColor: color[s.key], marginStart: i > 0 ? 1 : 0 }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14 }}>
        {legend.map((l) => (
          <Pressable
            key={l.key}
            accessibilityRole="button"
            accessibilityLabel={`${l.label} ${l.n}`}
            onPress={() => open(l.key)}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 }}
          >
            <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: l.color }} />
            <Text variant="caption" style={{ fontWeight: '700', color: theme.color.text }}>
              {l.n}
            </Text>
            <Text variant="caption" tone="muted">
              {l.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {summary.allMarked ? (
        <View
          accessible
          accessibilityLabel={t.company.ovAllMarked}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}
        >
          <Ionicons name="checkmark-circle" size={iconSize.base} color={GREEN} />
          <Text variant="caption" tone="muted">
            {t.company.ovAllMarked}
          </Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => open()}
          style={{
            minHeight: 44,
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brand,
          }}
        >
          <Text style={{ color: theme.color.onBrand, fontWeight: '700' }}>
            {t.company.ovMarkAttendance}
          </Text>
        </Pressable>
      )}
    </StandardCard>
  );

  const sheet = (
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
  );

  return compose({ attendance, attention: <AttentionList groupId={groupId} o={o} />, sheet });
}
