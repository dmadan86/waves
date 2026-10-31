import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '@waves/ui';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { PersonAvatar } from '@/components/PersonAvatar';
import type { MemberRow } from '@/data/types';
import { displayName, isGhost } from '@/data/types';
import type { MirrorWorkTask } from '@/data/companyWorkday';
import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { advanceWorkStatus } from '@/lib/companyWork';
import { useStrings } from '@/i18n';

export function WorkTaskSections({
  groupId,
  tasks,
  people,
  locale,
  canManage,
  busy,
  canChange,
  onChangeStatus,
  onOpen,
  departmentFor,
  siteName,
}: {
  groupId: string;
  tasks: readonly MirrorWorkTask[];
  people: readonly MemberRow[];
  locale: string;
  canManage: boolean;
  busy: boolean;
  canChange: (task: MirrorWorkTask) => boolean;
  onChangeStatus: (task: MirrorWorkTask, status: MirrorWorkTask['status']) => void;
  onOpen: (task: MirrorWorkTask) => void;
  departmentFor: (memberId: string) => string | undefined;
  siteName: (projectId: string) => string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <>
      {tasks.length === 0 ? <Text tone="muted">{t.company.workEmpty}</Text> : null}
      {(['todo', 'doing', 'done', 'blocked'] as const).map((status) => {
        const rows = tasks.filter((task) => task.status === status);
        if (!rows.length) return null;
        const title =
          status === 'todo'
            ? t.company.workTodo
            : status === 'doing'
              ? t.company.workDoing
              : status === 'done'
                ? t.company.workDone
                : t.company.workBlocked;
        return (
          <View key={status} style={{ gap: theme.spacing.xs }}>
            <SectionHeader title={`${title} (${rows.length})`} />
            <StandardCard style={{ gap: theme.spacing.sm }}>
              {rows.map((task) => {
                const person = people.find((candidate) => candidate.id === task.memberId);
                const dept = departmentFor(task.memberId);
                return (
                  <View
                    key={task.id}
                    style={{ gap: theme.spacing.xs, paddingVertical: theme.spacing.sm }}
                  >
                    <ListRow
                      title={task.title}
                      subtitle={`${person ? displayName(person) : ''}${dept ? ` · ${dept}` : ''} · ${new Date(`${task.day}T00:00:00Z`).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })}${task.dueTime ? `, ${new Date(`2020-01-01T${task.dueTime}:00Z`).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}` : ''}`}
                      leading={
                        person ? (
                          <PersonAvatar
                            member={person}
                            name={displayName(person)}
                            ghost={isGhost(person)}
                            size={40}
                          />
                        ) : undefined
                      }
                      trailing={
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: theme.spacing.xs,
                          }}
                        >
                          <Pressable
                            disabled={!canChange(task) || busy}
                            accessibilityRole="button"
                            accessibilityLabel={t.company.workStatus}
                            onPress={() => onChangeStatus(task, advanceWorkStatus(task.status))}
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 22,
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderWidth: task.status === 'done' ? 0 : 3,
                              borderColor:
                                task.status === 'todo'
                                  ? theme.color.border
                                  : task.status === 'blocked'
                                    ? theme.color.negative
                                    : task.status === 'done'
                                      ? theme.color.positive
                                      : theme.gradient.accent[0],
                              borderTopColor: task.status === 'doing' ? 'transparent' : undefined,
                              transform:
                                task.status === 'doing' ? [{ rotate: '-35deg' }] : undefined,
                              backgroundColor:
                                task.status === 'done' ? theme.color.positive : 'transparent',
                            }}
                          >
                            {task.status === 'done' || task.status === 'blocked' ? (
                              <Ionicons
                                name={task.status === 'done' ? 'checkmark' : 'alert'}
                                size={20}
                                color={task.status === 'done' ? '#fff' : theme.color.negative}
                              />
                            ) : null}
                          </Pressable>
                          <Pressable
                            disabled={busy}
                            accessibilityRole="button"
                            accessibilityLabel={
                              canManage ? t.company.workEdit : t.company.workStatus
                            }
                            onPress={() => onOpen(task)}
                            style={{
                              width: 36,
                              height: 44,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Ionicons
                              name="chevron-forward"
                              size={20}
                              color={theme.color.textMuted}
                            />
                          </Pressable>
                        </View>
                      }
                    />
                    {task.blockedReason ? (
                      <Text variant="caption" tone="negative">
                        {task.blockedReason}
                      </Text>
                    ) : null}
                    {task.note ? (
                      <Text variant="caption" tone="muted">
                        {task.note}
                      </Text>
                    ) : null}
                    <CompanyEntryPhotos
                      kind="task"
                      groupId={groupId}
                      entryId={task.id}
                      canAdd={false}
                      canRemove={() => canManage}
                    />
                    {task.projectId ? (
                      <View
                        style={{
                          alignSelf: 'flex-start',
                          paddingHorizontal: theme.spacing.sm,
                          paddingVertical: 2,
                          borderRadius: theme.radius.pill,
                          backgroundColor: theme.color.brandSoft,
                        }}
                      >
                        <Text
                          variant="micro"
                          style={{ color: theme.color.brand, fontWeight: '600' }}
                        >
                          {siteName(task.projectId)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </StandardCard>
          </View>
        );
      })}
    </>
  );
}
