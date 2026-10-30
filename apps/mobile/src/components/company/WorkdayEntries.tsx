import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { Text, useTheme } from '@waves/ui';
import { ActionTile } from '@/components/company/dashboard/parts';
import { ListRow, SectionHeader, SegmentedPills, StandardCard } from '@/components/standard';
import { useWorkdayAccess, useWorkTasks } from '@/data/companyWorkday';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export { useWorkdayCounts } from '@/data/companyWorkday';

type Props = { groupId: string };
export function AttendanceRow({ groupId }: Props) {
  const access = useWorkdayAccess(groupId);
  const { t } = useStrings();
  const theme = useTheme();
  if (!access.enabled || (!access.canManage && !access.isEmployee)) return null;
  return (
    <ListRow
      title={access.isEmployee ? t.company.attendanceMine : t.company.attendanceTitle}
      leading={<Ionicons name="calendar-outline" size={22} color={theme.color.brand} />}
      onPress={() => router.push(`/group/${groupId}/company-attendance`)}
    />
  );
}
export function WorkRow({ groupId }: Props) {
  const access = useWorkdayAccess(groupId);
  const { t } = useStrings();
  const theme = useTheme();
  if (!access.enabled) return null;
  return (
    <ListRow
      title={access.isEmployee ? t.company.workMine : t.company.workTitle}
      leading={<Ionicons name="checkbox-outline" size={22} color={theme.color.brand} />}
      onPress={() => router.push(`/group/${groupId}/company-work`)}
    />
  );
}
export function WorkdayTiles({ groupId }: Props) {
  const access = useWorkdayAccess(groupId);
  const { t } = useStrings();
  const theme = useTheme();
  if (!access.enabled) return null;
  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
      {access.canManage || access.isEmployee ? (
        <ActionTile
          icon="calendar-outline"
          title={access.isEmployee ? t.company.attendanceMine : t.company.attendanceTitle}
          body={t.company.periodMonth}
          tone="violet"
          onPress={() => router.push(`/group/${groupId}/company-attendance`)}
        />
      ) : null}
      <ActionTile
        icon="checkbox-outline"
        title={access.isEmployee ? t.company.workMine : t.company.workTitle}
        body={t.company.workSeeAll}
        tone="blue"
        onPress={() => router.push(`/group/${groupId}/company-work`)}
      />
    </View>
  );
}
export function MyWorkTodayCard({ groupId }: Props) {
  const access = useWorkdayAccess(groupId);
  const tasks = useWorkTasks(groupId);
  const { t } = useStrings();
  const theme = useTheme();
  const own = tasks.filter((task) => task.memberId === access.me?.id && task.day === todayIso());
  if (!access.enabled || (!own.length && !access.isEmployee)) return null;
  const labels = {
    todo: t.company.workTodo,
    doing: t.company.workDoing,
    done: t.company.workDone,
    blocked: t.company.workBlocked,
  };
  return (
    <StandardCard style={{ gap: theme.spacing.sm }}>
      <SectionHeader
        title={t.company.workMine}
        action={{
          label: t.company.workSeeAll,
          onPress: () => router.push(`/group/${groupId}/company-work`),
        }}
      />
      {own.length ? (
        own
          .slice(0, 3)
          .map((task) => (
            <ListRow
              key={task.id}
              title={task.title}
              subtitle={task.blockedReason ?? task.note ?? undefined}
              trailing={
                <SegmentedPills
                  options={[{ value: task.status, label: labels[task.status] }]}
                  value={task.status}
                  onChange={() => router.push(`/group/${groupId}/company-work`)}
                />
              }
            />
          ))
      ) : (
        <Text variant="caption" tone="muted">
          {t.company.workEmpty}
        </Text>
      )}
    </StandardCard>
  );
}
