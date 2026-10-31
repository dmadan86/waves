import { useRef } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { iconSize, Text, useTheme } from '@waves/ui';
import { RED, withAlpha } from '@/components/company/dashboard/overviewKit';
import { StandardCard } from '@/components/standard';
import { PersonAvatar } from '@/components/PersonAvatar';
import type { MenuAnchor } from '@/components/SortMenu';
import type { MemberRow } from '@/data/types';
import { displayName, isGhost } from '@/data/types';
import type { MirrorWorkTask } from '@/data/companyWorkday';
import { useCompanyPhotos } from '@/data/companyEntries';
import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { formatWorkTime } from '@/lib/companyWork';
import { useStrings } from '@/i18n';
import { WORK_INK } from './WorkSummaryControls';

function TaskRow({
  groupId,
  task,
  person,
  first,
  today,
  locale,
  canManage,
  canChange,
  busy,
  site,
  onChangeStatus,
  onOpen,
  onMenu,
}: {
  groupId: string;
  task: MirrorWorkTask;
  person: MemberRow | undefined;
  first: boolean;
  today: string;
  locale: string;
  canManage: boolean;
  canChange: boolean;
  busy: boolean;
  site: string;
  onChangeStatus: (task: MirrorWorkTask, status: MirrorWorkTask['status']) => void;
  onOpen: (task: MirrorWorkTask) => void;
  onMenu: (task: MirrorWorkTask, anchor: MenuAnchor | null) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const menuRef = useRef<View>(null);
  const photos = useCompanyPhotos(task.id).length;
  const done = task.status === 'done';
  const ink = WORK_INK[task.status] ?? RED;
  const late = !done && task.day <= today;
  const dueInk = late ? RED : theme.color.textMuted;
  const label =
    task.status === 'todo'
      ? t.company.workTodo
      : task.status === 'doing'
        ? t.company.workDoing
        : done
          ? t.company.workDone
          : t.company.workBlocked;
  return (
    <View
      style={{
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.color.border,
        paddingVertical: 10,
        gap: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 48 }}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done, disabled: !canChange || busy }}
          accessibilityLabel={t.company.workDone}
          disabled={!canChange || busy}
          hitSlop={10}
          onPress={() => onChangeStatus(task, done ? 'todo' : 'done')}
          style={{
            width: 22,
            height: 22,
            marginTop: 1,
            borderRadius: 6,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: done ? theme.color.positive : theme.color.textFaint,
            backgroundColor: done ? theme.color.positive : 'transparent',
          }}
        >
          {done ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onOpen(task)}
          style={{ flex: 1, minWidth: 0, gap: 2 }}
        >
          <Text variant="body" numberOfLines={2} style={{ fontWeight: '700' }}>
            {task.title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="calendar-outline" size={iconSize.sm} color={dueInk} />
            <Text variant="caption" numberOfLines={1} style={{ color: dueInk, flexShrink: 1 }}>
              {formatWorkTime(task.day, task.dueTime ?? null, today, locale, t.company.workToday)}
            </Text>
          </View>
          {site ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="location-outline" size={iconSize.sm} color={theme.color.textMuted} />
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {site}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {person ? (
              <PersonAvatar
                member={person}
                name={displayName(person)}
                ghost={isGhost(person)}
                size={26}
              />
            ) : null}
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 3,
                borderRadius: 12,
                backgroundColor: withAlpha(ink ?? RED, 0.12),
              }}
            >
              <Text variant="micro" style={{ color: ink ?? RED, fontWeight: '700' }}>
                {label}
              </Text>
            </View>
          </View>
          {photos > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name="attach" size={iconSize.sm} color={theme.color.textMuted} />
              <Text variant="caption" tone="muted">
                {photos}
              </Text>
            </View>
          ) : null}
        </View>
        {canManage ? (
          <View ref={menuRef} collapsable={false}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.company.workEdit}
              disabled={busy}
              hitSlop={8}
              onPress={() =>
                menuRef.current
                  ? menuRef.current.measureInWindow((x, y, width, height) =>
                      onMenu(task, width > 0 ? { x, y, width, height } : null),
                    )
                  : onMenu(task, null)
              }
              style={{ width: 24, height: 28, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="ellipsis-vertical" size={18} color={theme.color.textMuted} />
            </Pressable>
          </View>
        ) : null}
      </View>
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
    </View>
  );
}

export function WorkTaskSections({
  groupId,
  tasks,
  people,
  locale,
  today,
  canManage,
  busy,
  canChange,
  onChangeStatus,
  onOpen,
  onMenu,
  siteName,
}: {
  groupId: string;
  tasks: readonly MirrorWorkTask[];
  people: readonly MemberRow[];
  locale: string;
  today: string;
  canManage: boolean;
  busy: boolean;
  canChange: (task: MirrorWorkTask) => boolean;
  onChangeStatus: (task: MirrorWorkTask, status: MirrorWorkTask['status']) => void;
  onOpen: (task: MirrorWorkTask) => void;
  onMenu: (task: MirrorWorkTask, anchor: MenuAnchor | null) => void;
  siteName: (projectId: string) => string;
}) {
  const { t } = useStrings();
  if (tasks.length === 0) return <Text tone="muted">{t.company.workEmpty}</Text>;
  return (
    <StandardCard style={{ paddingHorizontal: 12, paddingVertical: 0, borderRadius: 22 }}>
      {tasks.map((task, i) => (
        <TaskRow
          key={task.id}
          groupId={groupId}
          task={task}
          person={people.find((p) => p.id === task.memberId)}
          first={i === 0}
          today={today}
          locale={locale}
          canManage={canManage}
          canChange={canChange(task)}
          busy={busy}
          site={task.projectId ? siteName(task.projectId) : ''}
          onChangeStatus={onChangeStatus}
          onOpen={onOpen}
          onMenu={onMenu}
        />
      ))}
    </StandardCard>
  );
}
