import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { iconSize, Text, useTheme } from '@waves/ui';
import { RED, withAlpha } from '@/components/company/dashboard/overviewKit';
import { StandardCard } from '@/components/standard';
import { PersonAvatar } from '@/components/PersonAvatar';
import type { MenuAnchor } from '@/components/SortMenu';
import type { MemberRow } from '@/data/types';
import { displayName } from '@/data/types';
import type { MirrorWorkTask } from '@/data/companyWorkday';
import { dayHeading } from '@/data/activity';
import { priorityMark, workDueText, type WorkMode, type WorkSection } from '@/lib/companyWork';
import { useStrings } from '@/i18n';
import { WORK_INK } from './WorkSummaryControls';

const ORANGE = '#F08A24';
const TINTS = ['lilac', 'peach', 'sky', 'pink', 'mint', 'coral'] as const;

function TaskRow({
  task,
  person,
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
  task: MirrorWorkTask;
  person: MemberRow | undefined;
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
  const done = task.status === 'done';
  const ink = WORK_INK[task.status];
  const dueInk = theme.color.textMuted;
  const mark = priorityMark(task.priority);
  const label =
    task.status === 'todo'
      ? t.company.workTodo
      : task.status === 'doing'
        ? t.company.workDoing
        : done
          ? t.company.workDone
          : t.company.workBlocked;
  return (
    <StandardCard style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
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
          <Text variant="body" numberOfLines={1} style={{ fontWeight: '700' }}>
            <Text variant="caption" tone="muted">
              {`#${task.number ?? '—'} `}
            </Text>
            {mark ? (
              <Text
                style={{ color: task.priority === 'very_urgent' ? RED : ORANGE, fontWeight: '800' }}
              >
                {`${mark} `}
              </Text>
            ) : null}
            {task.title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="calendar-outline" size={iconSize.sm} color={dueInk} />
            <Text variant="caption" numberOfLines={1} style={{ color: dueInk, flexShrink: 0 }}>
              {workDueText(task, today, locale, t.company.workToday, t.company.workLateOn)}
            </Text>
            {site ? (
              <>
                <Ionicons
                  name="location-outline"
                  size={iconSize.sm}
                  color={theme.color.textMuted}
                  style={{ marginLeft: 4 }}
                />
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {site}
                </Text>
              </>
            ) : null}
          </View>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {person ? (
            <PersonAvatar
              name={displayName(person)}
              ghost
              tint={TINTS[(person.id.charCodeAt(0) + person.id.length) % TINTS.length]}
              size={26}
            />
          ) : null}
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 12,
              backgroundColor: withAlpha(ink, 0.12),
            }}
          >
            <Text variant="micro" style={{ color: ink, fontWeight: '700' }}>
              {label}
            </Text>
          </View>
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
    </StandardCard>
  );
}

export function WorkTaskSections({
  groupId,
  sections,
  done,
  mode,
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
  sections: readonly WorkSection[];
  /** Done tasks from before today: one collapsed tail. */
  done: readonly MirrorWorkTask[];
  mode: WorkMode;
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
  const theme = useTheme();
  const [showDone, setShowDone] = useState(false);
  if (sections.length === 0 && done.length === 0)
    return <Text tone="muted">{t.company.workNoTasks}</Text>;
  const rows = (tasks: readonly MirrorWorkTask[]) =>
    tasks.map((task) => (
      <TaskRow
        key={task.id}
        task={task}
        person={people.find((p) => p.id === task.memberId)}
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
    ));
  const heading = (section: WorkSection) => {
    const text =
      section.kind === 'overdue'
        ? `${t.company.workOverdue} · ${section.tasks.length}`
        : section.kind === 'day'
          ? dayHeading(locale, `${section.ref}T12:00:00`)
          : (() => {
              const p = people.find((m) => m.id === section.ref);
              return `${p ? displayName(p) : ''} · ${t.company.workOpenN.replace('{n}', String(section.open))}`;
            })();
    return (
      <Text
        variant="caption"
        tone="muted"
        style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600' }}
      >
        {text}
      </Text>
    );
  };
  return (
    <View style={{ gap: theme.spacing.md }}>
      {sections.map((section) => (
        <View key={section.key} style={{ gap: 6 }}>
          {heading(section)}
          {rows(section.tasks)}
        </View>
      ))}
      {done.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showDone }}
            onPress={() => setShowDone((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Ionicons
              name={showDone ? 'chevron-down' : 'chevron-forward'}
              size={iconSize.sm}
              color={theme.color.textMuted}
            />
            <Text
              variant="caption"
              tone="muted"
              style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600' }}
            >
              {t.company.workDoneN.replace('{n}', String(done.length))}
            </Text>
          </Pressable>
          {showDone ? rows(done) : null}
        </View>
      ) : null}
    </View>
  );
}
