import { Pressable, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { StandardCard } from '@/components/standard';
import { useActiveToday, useTodayCounts } from '@/data/companyOverview';
import { useStrings, fill } from '@/i18n';
import { router } from '@/lib/navigation';

export function TodayTiles({ groupId, hasEmployees }: { groupId: string; hasEmployees: boolean }) {
  const theme = useTheme();
  const { t } = useStrings();
  const counts = useTodayCounts(groupId);
  const active = useActiveToday(groupId);
  if (!hasEmployees) return null;
  const tiles = [
    ...(counts.attendance
      ? [
          {
            key: 'attendance',
            label: t.company.overviewAttendance,
            value: `${counts.attendance.present}/${counts.attendance.absent}/${counts.attendance.unmarked}`,
            detail: `${t.company.overviewPresent} · ${t.company.overviewAbsent} · ${t.company.overviewUnmarked}`,
            route: `/group/${groupId}/company-attendance`,
          },
        ]
      : []),
    {
      key: 'tasks',
      label: t.company.overviewTasks,
      value: counts.tasks
        ? `${counts.tasks.done}/${counts.tasks.doing + counts.tasks.todo}/${counts.tasks.blocked}`
        : t.company.overviewNoTasks,
      detail: counts.tasks
        ? `${t.company.overviewDone} · ${t.company.overviewDoing} · ${t.company.overviewBlocked}`
        : '',
      route: `/group/${groupId}/company-work`,
    },
    ...(active && active.total > 0
      ? [
          {
            key: 'active',
            label: t.company.overviewActiveToday,
            value: fill(t.company.overviewUsedWaves, {
              active: String(active.active),
              total: String(active.total),
            }),
            detail: '',
            route: `/group/${groupId}/company-people?filter=activeToday`,
          },
        ]
      : []),
  ];
  if (!tiles.length) return null;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="heading">{t.company.overviewToday}</Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {tiles.map((tile) => (
          <Pressable
            key={tile.key}
            accessibilityRole="button"
            onPress={() => router.push(tile.route)}
            style={{ flex: 1 }}
          >
            <StandardCard style={{ minHeight: 92, padding: theme.spacing.sm, gap: 3 }}>
              <Text variant="micro" tone="muted" numberOfLines={1}>
                {tile.label}
              </Text>
              <Text
                variant="body"
                style={{ fontWeight: '700' }}
                numberOfLines={2}
                adjustsFontSizeToFit
              >
                {tile.value}
              </Text>
              {tile.detail ? (
                <Text variant="micro" tone="muted" numberOfLines={2}>
                  {tile.detail}
                </Text>
              ) : null}
            </StandardCard>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
