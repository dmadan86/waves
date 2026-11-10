import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { Button, iconSize, Text, useTheme } from '@waves/ui';
import { RED, withAlpha } from '@/components/company/dashboard/overviewKit';
import { StandardCard } from '@/components/standard';
import type { MenuAnchor } from '@/components/SortMenu';
import type { MemberRow } from '@/data/types';
import { displayName } from '@/data/types';
import type { MirrorWorkTask } from '@/data/companyWorkday';
import { dayHeading } from '@/data/activity';
import {
  priorityMark,
  workDueText,
  type EmptyTasks,
  type WorkMode,
  type WorkSection,
} from '@/lib/companyWork';
import { useStrings } from '@/i18n';
import { WORK_INK } from './WorkSummaryControls';

const ORANGE = '#F08A24';

function TaskRow({
  task,
  person,
  names,
  today,
  locale,
  canManage,
  canChange,
  busy,
  site,
  onOpen,
  onMenu,
}: {
  task: MirrorWorkTask;
  person: MemberRow | undefined;
  /** A member's name, empty when this viewer cannot see them (an employee sees only themselves). */
  names: (memberId: string) => string;
  today: string;
  locale: string;
  canManage: boolean;
  canChange: boolean;
  busy: boolean;
  site: string;
  onOpen: (task: MirrorWorkTask) => void;
  onMenu: (task: MirrorWorkTask, anchor: MenuAnchor | null) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const menuRef = useRef<View>(null);
  const ink = {
    todo: theme.color.brand,
    doing: '#1D4ED8',
    done: WORK_INK.done,
    blocked: WORK_INK.blocked,
  }[task.status];
  const statusIcon = {
    todo: 'calendar-outline',
    doing: 'play-circle-outline',
    done: 'checkmark-circle',
    blocked: 'alert-circle-outline',
  } as const;
  const mark = priorityMark(task.priority);
  const helpers = task.helperIds ?? [];
  const label = {
    todo: t.company.workTodo,
    doing: t.company.workDoing,
    done: t.company.workDone,
    blocked: t.company.workBlocked,
  }[task.status];
  // The tile reads the priority, else the site; no categories exist in the data.
  const tile =
    task.priority === 'very_urgent'
      ? { icon: 'alert-circle-outline' as const, color: RED }
      : task.priority === 'urgent'
        ? { icon: 'flash' as const, color: ORANGE }
        : {
            icon: (site ? 'location-outline' : 'clipboard-outline') as 'clipboard-outline',
            color: theme.color.brand,
          };
  const who = [
    person ? displayName(person) + (helpers.length > 0 ? ` +${helpers.length}` : '') : '',
    site,
  ]
    .filter(Boolean)
    .join(' \u2022 ');
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(tile.color, 0.12),
        }}
      >
        <Ionicons name={tile.icon} size={22} color={tile.color} />
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => onOpen(task)}
        style={{ flex: 1, minWidth: 0, gap: 2 }}
      >
        <Text variant="body" numberOfLines={1} style={{ fontWeight: '700' }}>
          {mark ? (
            <Text
              style={{ color: task.priority === 'very_urgent' ? RED : ORANGE, fontWeight: '800' }}
            >
              {`${mark} `}
            </Text>
          ) : null}
          {task.title}
        </Text>
        {who ? (
          <Text
            variant="caption"
            tone="muted"
            numberOfLines={1}
            accessibilityLabel={
              helpers.length > 0
                ? `${who}. ${t.company.workAlsoOn.replace(
                    '{names}',
                    helpers.map(names).filter(Boolean).join(', ') || String(helpers.length),
                  )}`
                : undefined
            }
          >
            {who}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="time-outline" size={iconSize.sm} color={theme.color.textMuted} />
          <Text variant="caption" numberOfLines={1} tone="muted" style={{ flexShrink: 1 }}>
            {workDueText(task, today, locale, t.company.workToday, t.company.workLateOn)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={!canChange || busy}
        onPress={() => onOpen(task)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 14,
          backgroundColor: withAlpha(ink, 0.12),
        }}
      >
        <Ionicons name={statusIcon[task.status]} size={14} color={ink} />
        <Text variant="micro" style={{ color: ink, fontWeight: '700' }}>
          {label}
        </Text>
      </Pressable>
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
  onOpen,
  onMenu,
  siteName,
  empty,
  query,
  onShowTeam,
  onAdd,
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
  onOpen: (task: MirrorWorkTask) => void;
  onMenu: (task: MirrorWorkTask, anchor: MenuAnchor | null) => void;
  siteName: (projectId: string) => string;
  empty: EmptyTasks;
  query: string;
  onShowTeam: () => void;
  /** Only for people who can add tasks. */
  onAdd?: () => void;
}) {
  const { t } = useStrings();
  const theme = useTheme();
  const [showDone, setShowDone] = useState(false);
  if (sections.length === 0 && done.length === 0)
    return (
      <View style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
        {empty.kind === 'search' ? (
          <Text tone="muted">{t.company.workNoMatch.replace('{q}', query.trim())}</Text>
        ) : empty.kind === 'mine' ? (
          <>
            <Text tone="muted">
              {t.company.workNoneForYou}
              {empty.blockedInTeam > 0
                ? ` · ${t.company.workBlockedInTeam.replace('{n}', String(empty.blockedInTeam))}`
                : ''}
            </Text>
            <Pressable accessibilityRole="link" onPress={onShowTeam} hitSlop={8}>
              <Text tone="brand">{t.company.workShowTeam}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text variant="subheading">{t.company.workNoTasks}</Text>
            <Text tone="muted">{t.company.workNoTasksHint}</Text>
            {onAdd ? (
              <Button
                label={t.company.workAdd}
                onPress={onAdd}
                style={{ borderRadius: theme.radius.md }}
              />
            ) : null}
          </>
        )}
      </View>
    );
  const rows = (tasks: readonly MirrorWorkTask[]) => (
    <StandardCard style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
      {tasks.map((task, i) => (
        <View
          key={task.id}
          style={i > 0 ? { borderTopWidth: 1, borderTopColor: theme.color.border } : undefined}
        >
          <TaskRow
            task={task}
            person={people.find((p) => p.id === task.memberId)}
            names={(id) => {
              const p = people.find((m) => m.id === id);
              return p ? displayName(p) : '';
            }}
            today={today}
            locale={locale}
            canManage={canManage}
            canChange={canChange(task)}
            busy={busy}
            site={task.projectId ? siteName(task.projectId) : ''}
            onOpen={onOpen}
            onMenu={onMenu}
          />
        </View>
      ))}
    </StandardCard>
  );
  const statusLabel = (status: MirrorWorkTask['status']) =>
    status === 'todo'
      ? t.company.workTodo
      : status === 'doing'
        ? t.company.workDoing
        : status === 'done'
          ? t.company.workDone
          : t.company.workBlocked;
  const heading = (section: WorkSection) => {
    const text =
      section.kind === 'overdue'
        ? t.company.workOverdue
        : section.kind === 'day'
          ? dayHeading(locale, `${section.ref}T12:00:00`)
          : section.kind === 'status'
            ? statusLabel(section.ref as MirrorWorkTask['status'])
            : (() => {
                const p = people.find((m) => m.id === section.ref);
                return `${p ? displayName(p) : ''} · ${t.company.workOpenN.replace('{n}', String(section.open))}`;
              })();
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="body" style={{ fontWeight: '700', flexShrink: 1 }}>
          {text}
        </Text>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 3,
            borderRadius: 12,
            backgroundColor: withAlpha(theme.color.brand, 0.12),
          }}
        >
          <Text variant="micro" style={{ color: theme.color.brand, fontWeight: '700' }}>
            {t.company.workTasksN.replace('{n}', String(section.tasks.length))}
          </Text>
        </View>
      </View>
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
