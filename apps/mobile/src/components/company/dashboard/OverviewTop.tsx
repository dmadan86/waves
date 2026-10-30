/**
 * The top of the company Overview, as drawn in the owner's mockup: the attendance summary
 * (with Mark attendance), today's tasks beside the Urgent card. Owners see everyone, a manager only their team. Waves records; it never moves money.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import {
  IconDisc,
  RED,
  Skeleton,
  TintCard,
  withAlpha,
} from '@/components/company/dashboard/overviewKit';
import { GREEN, BLUE } from '@/components/company/dashboard/parts';
import { StandardCard } from '@/components/standard';
import { useOverview } from '@/data/companyOverview';
import { todayIso } from '@/data/personal';
import { fill, plural, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { attendanceSegments, urgentItems, urgentRoute, type UrgentKey } from '@/lib/overviewMath';

export function OverviewTop({
  groupId,
  afterAttendanceCard,
  afterAttendance,
}: {
  groupId: string;
  /** Owner's money cards: they sit right under the attendance card. */
  afterAttendanceCard?: ReactNode;
  /** Owner's upcoming payments: they follow the attendance strip. */
  afterAttendance?: ReactNode;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const day = todayIso();
  const o = useOverview(groupId, day);
  const attColor = { present: GREEN, unmarked: theme.color.textMuted, absent: RED };
  const attLabel = {
    present: t.company.overviewPresent,
    unmarked: t.company.overviewUnmarked,
    absent: t.company.overviewAbsent,
  };
  // Present always shows; the other two only when someone is in them.
  const segments = attendanceSegments(o.counts);
  const legend = (['present', 'unmarked', 'absent'] as const)
    .filter((k) => k === 'present' || o.counts[k] > 0)
    .map((k) => ({ key: k, label: attLabel[k], color: attColor[k], n: o.counts[k] }));
  const attTitle = t.company.ovAttendanceToday;
  const attendanceRoute = `/group/${groupId}/company-attendance?date=${day}`;

  if (!o.ready)
    return (
      <View style={{ gap: theme.spacing.md }} accessibilityLabel={t.common.loading}>
        <Skeleton height={104} style={{ marginTop: -28 }} />
      </View>
    );

  const employees = o.people.length;
  const empty = employees === 0;

  if (empty)
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
      </>
    );

  const urgent = urgentItems(o.urgent);
  const urgentTotal = urgent.reduce((sum, u) => sum + u.n, 0);
  const urgentLine = (key: UrgentKey, n: number): string =>
    plural(
      locale,
      n,
      key === 'absent'
        ? t.company.ovAbsentN
        : key === 'paymentsPending'
          ? t.company.ovPaymentsPendingN
          : key === 'blockedTasks'
            ? t.company.ovTasksBlockedN
            : key === 'approvals'
              ? t.company.ovApprovalsN
              : t.company.ovBillsN,
    );
  const tasks = o.tasks;
  const progress = tasks.total > 0 ? tasks.done / tasks.total : 0;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${attTitle}: ${legend.map((l) => `${l.label} ${l.n}`).join(', ')}`}
        onPress={() => router.push(attendanceRoute)}
        style={{ marginTop: -28 }}
      >
        <StandardCard
          style={{
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderRadius: 22,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text
              variant="title"
              numberOfLines={1}
              style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: '700' }}
            >
              {attTitle}
            </Text>
            {!o.suspended ? (
              <MarkButton
                label={t.company.ovMarkAttendance}
                onPress={() => router.push(attendanceRoute)}
              />
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 }}>
            {legend.map((l) => (
              <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View
                  style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: l.color }}
                />
                <Text variant="caption" style={{ color: theme.color.text }}>
                  {l.label}
                </Text>
                <Text variant="caption" style={{ fontWeight: '700', color: theme.color.text }}>
                  {l.n}
                </Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden' }}>
            {segments.map((s, i) => (
              <View
                key={s.key}
                style={{
                  flex: s.n,
                  backgroundColor: attColor[s.key],
                  marginStart: i > 0 ? 2 : 0,
                }}
              />
            ))}
          </View>
        </StandardCard>
      </Pressable>

      {afterAttendanceCard}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/group/${groupId}/company-work`)}
          style={{ flex: 1 }}
        >
          <TintCard ink={BLUE} style={{ flex: 1, minHeight: 138, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <IconDisc ink={BLUE}>
                <Ionicons name="clipboard-outline" size={iconSize.base} color={BLUE} />
              </IconDisc>
              <Text
                variant="caption"
                numberOfLines={2}
                style={{ flex: 1, fontSize: 14, color: theme.color.text }}
              >
                {t.company.ovTasksTitle}
              </Text>
              <Chevron />
            </View>
            <Text
              variant="title"
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ fontSize: 20, fontWeight: '800' }}
            >
              {tasks.total === 0
                ? t.company.ovTasksNone
                : fill(t.company.ovTasksPending, { n: tasks.pending })}
            </Text>
            {tasks.total > 0 ? (
              <>
                <View
                  style={{
                    height: 7,
                    borderRadius: 4,
                    overflow: 'hidden',
                    backgroundColor: withAlpha(theme.color.brand, 0.16),
                  }}
                >
                  <View
                    style={{
                      height: 7,
                      width: `${Math.round(progress * 100)}%`,
                      backgroundColor: theme.color.brand,
                    }}
                  />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
                  <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {fill(t.company.ovTasksDone, { n: tasks.done })}
                  </Text>
                  <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {fill(t.company.ovTasksTotal, { n: tasks.total })}
                  </Text>
                </View>
              </>
            ) : null}
          </TintCard>
        </Pressable>

        {urgent.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/group/${groupId}/${urgentRoute(urgent)}`)}
            style={{ flex: 1 }}
          >
            <TintCard ink={RED} style={{ flex: 1, minHeight: 138, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <IconDisc ink={RED}>
                  <Ionicons name="warning-outline" size={iconSize.base} color={RED} />
                </IconDisc>
                <Text
                  variant="caption"
                  numberOfLines={1}
                  style={{ fontSize: 14, color: theme.color.text, flexShrink: 1 }}
                >
                  {t.company.ovUrgent}
                </Text>
                <View
                  style={{
                    minWidth: 20,
                    height: 20,
                    borderRadius: 10,
                    paddingHorizontal: 5,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: RED,
                  }}
                >
                  <Text variant="micro" style={{ color: '#FFFFFF', fontWeight: '700' }}>
                    {urgentTotal > 99 ? '99+' : urgentTotal}
                  </Text>
                </View>
                <View style={{ flex: 1 }} />
                <Chevron />
              </View>
              {urgent.slice(0, 3).map((u) => (
                <View key={u.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: RED }} />
                  <Text
                    variant="caption"
                    numberOfLines={2}
                    style={{ flex: 1, fontSize: 13, color: theme.color.text }}
                  >
                    {urgentLine(u.key, u.n)}
                  </Text>
                </View>
              ))}
            </TintCard>
          </Pressable>
        ) : (
          <TintCard
            ink={GREEN}
            style={{
              flex: 1,
              minHeight: 138,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <IconDisc ink={GREEN} size={40}>
              <Ionicons name="checkmark-circle-outline" size={iconSize.lg} color={GREEN} />
            </IconDisc>
            <Text
              variant="caption"
              align="center"
              style={{ fontSize: 14, fontWeight: '700', color: theme.color.text }}
            >
              {t.company.ovAllClear}
            </Text>
          </TintCard>
        )}
      </View>

      {afterAttendance}
    </>
  );
}

function Chevron() {
  const theme = useTheme();
  return (
    <Ionicons
      name={directionalIcon('chevron-forward')}
      size={iconSize.sm}
      color={theme.color.textMuted}
    />
  );
}

function MarkButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        height: 34,
        borderRadius: 17,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: theme.color.brand,
        flexShrink: 1,
        maxWidth: '55%',
      }}
    >
      <Ionicons name="people-outline" size={iconSize.sm} color={theme.color.onBrand} />
      <Text
        numberOfLines={1}
        style={{ color: theme.color.onBrand, fontWeight: '600', fontSize: 13, flexShrink: 1 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
