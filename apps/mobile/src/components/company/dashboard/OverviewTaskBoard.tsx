/**
 * The owner Overview's task block, as drawn in the owner's mockups: four summary tiles, filter pills, then
 * Overdue / Today / This week / Later cards of up to two tasks. The tick box and the ⋮ menu change a task's
 * status through the same queue as the Tasks screen, only for people the viewer manages; "View all" opens
 * the Tasks screen (it has no per-bucket filter). Also the members/sites chips and the quick actions.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View, type GestureResponderEvent } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import {
  AMBER,
  IconDisc,
  RED,
  Skeleton,
  withAlpha,
} from '@/components/company/dashboard/overviewKit';
import { GREEN } from '@/components/company/dashboard/parts';
import { OverflowMenu } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import type { MenuAnchor } from '@/components/SortMenu';
import { StandardCard } from '@/components/standard';
import { useCompanyEntries, useCompanyProjects } from '@/data/companyEntries';
import {
  useSetWorkTask,
  useWorkdayAccess,
  useWorkTasks,
  type MirrorWorkTask,
} from '@/data/companyWorkday';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { bucketOverviewTasks, canChangeTask, formatWorkTime } from '@/lib/companyWork';
import { router } from '@/lib/navigation';

const BLUE = '#2F6FE0';
const LAVENDER = '#7C5CE0';
const TINTS = ['lilac', 'peach', 'sky', 'pink', 'mint', 'coral'] as const;
type Bucket = 'overdue' | 'today' | 'week' | 'later';
type Pill = 'all' | 'overdue' | 'today' | 'upcoming';
const SHOWN: Record<Pill, readonly Bucket[]> = {
  all: ['overdue', 'today', 'week', 'later'],
  overdue: ['overdue'],
  today: ['today'],
  upcoming: ['week', 'later'],
};

function Pillbox({ label, ink }: { label: string; ink: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: withAlpha(ink, 0.12),
      }}
    >
      <Text variant="micro" style={{ color: ink, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

/** Everything the block reads: the viewer's people's tasks, split into buckets, plus what a row needs. */
function useBoard(groupId: string) {
  const view = useCompanyEntries(groupId);
  const access = useWorkdayAccess(groupId);
  const sites = useCompanyProjects(groupId);
  const all = useWorkTasks(groupId);
  const today = todayIso();
  const ids = new Set(access.people.map((m) => m.id));
  const buckets = bucketOverviewTasks(
    all.filter((x) => ids.has(x.memberId)),
    today,
  );
  return { view, access, sites, buckets, today };
}

export function TaskBoard({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { view, access, sites, buckets, today } = useBoard(groupId);
  const save = useSetWorkTask(groupId);
  const [pill, setPill] = useState<Pill>('all');
  const [menu, setMenu] = useState<{ task: MirrorWorkTask; anchor: MenuAnchor } | null>(null);
  if (!view.ready) return <Skeleton height={260} />;
  const c = t.company;
  const counts = {
    overdue: buckets.overdue.length,
    today: buckets.today.length,
    week: buckets.week.length,
    later: buckets.later.length,
  };
  const upcoming = counts.week + counts.later;
  const go = () => router.push(`/group/${groupId}/company-work`);
  const canChange = (x: MirrorWorkTask) =>
    !view.suspended &&
    canChangeTask(x, {
      enabled: access.enabled,
      isEmployee: false,
      meId: null,
      allowedPerson: (id) => access.canManage && access.people.some((p) => p.id === id),
    });
  const setStatus = (x: MirrorWorkTask, status: MirrorWorkTask['status']) => {
    // A silent retry is the queue's job; there is nothing to refuse here.
    if (!canChange(x) || save.isPending) return;
    save.mutate({
      taskId: x.id,
      memberId: x.memberId,
      day: x.day,
      title: x.title,
      projectId: x.projectId,
      status,
      blockedReason: null,
      note: x.note,
      dueTime: x.dueTime ?? null,
      priority: x.priority ?? 'normal',
      helperIds: x.helperIds ?? [],
    });
  };
  const tiles = [
    { ink: RED, icon: 'alert-circle-outline', n: counts.overdue, label: c.workOverdue },
    { ink: BLUE, icon: 'today-outline', n: counts.today, label: t.calendar.today },
    { ink: LAVENDER, icon: 'calendar-outline', n: counts.week, label: c.workThisWeek },
    { ink: GREEN, icon: 'checkmark-circle-outline', n: buckets.done, label: c.tkCompleted },
  ] as const;
  const pills: { key: Pill; label: string; n: number }[] = [
    { key: 'all', label: c.tkAll, n: counts.overdue + counts.today + upcoming },
    { key: 'overdue', label: c.workOverdue, n: counts.overdue },
    { key: 'today', label: t.calendar.today, n: counts.today },
    { key: 'upcoming', label: t.calendar.upcoming, n: upcoming },
  ];
  const sections: {
    key: Bucket;
    title: string;
    icon: keyof typeof Ionicons.glyphMap;
    ink: string;
  }[] = [
    { key: 'overdue', title: c.workOverdue, icon: 'alert-circle-outline', ink: RED },
    { key: 'today', title: t.calendar.today, icon: 'today-outline', ink: BLUE },
    { key: 'week', title: c.workThisWeek, icon: 'calendar-outline', ink: LAVENDER },
    { key: 'later', title: c.tkLater, icon: 'time-outline', ink: theme.color.textMuted },
  ];
  const who = (id: string) => view.members.find((m) => m.id === id);
  const status = (x: MirrorWorkTask) =>
    x.day < today
      ? { label: c.workOverdue, ink: RED }
      : x.status === 'blocked'
        ? { label: c.workBlocked, ink: RED }
        : x.status === 'doing'
          ? { label: c.workDoing, ink: BLUE }
          : x.day > today
            ? { label: c.tkScheduled, ink: theme.color.brand }
            : { label: c.workTodo, ink: theme.color.textMuted };
  const visible = sections.filter((s) => SHOWN[pill].includes(s.key) && counts[s.key] > 0);
  const menuItems = menu
    ? (
        [
          ['doing', 'play-outline', c.workDoing],
          ['done', 'checkmark-outline', c.workDone],
          ['todo', 'ellipse-outline', c.workTodo],
        ] as const
      )
        .filter(([s]) => s !== menu.task.status && canChange(menu.task))
        .map(([s, icon, label]) => ({
          icon,
          label,
          onPress: () => setStatus(menu.task, s),
        }))
    : [];

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {tiles.map((x) => (
          <Pressable
            key={x.label}
            accessibilityRole="button"
            accessibilityLabel={`${x.label}: ${x.n}`}
            onPress={go}
            style={{
              flex: 1,
              minWidth: 0,
              gap: 4,
              padding: 10,
              borderRadius: 12,
              backgroundColor: withAlpha(x.ink, 0.1),
            }}
          >
            <Ionicons name={x.icon} size={iconSize.md} color={x.ink} />
            <Text variant="title" style={{ fontSize: 22, fontWeight: '800', color: x.ink }}>
              {x.n}
            </Text>
            <Text variant="micro" numberOfLines={1} style={{ color: x.ink, fontWeight: '600' }}>
              {x.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {pills.map((p) => {
          const on = pill === p.key;
          return (
            <Pressable
              key={p.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${p.label} ${p.n}`}
              onPress={() => setPill(p.key)}
              style={{
                minHeight: 36,
                paddingHorizontal: 12,
                borderRadius: 18,
                justifyContent: 'center',
                backgroundColor: on ? theme.color.brand : theme.color.surface,
                borderWidth: 1,
                borderColor: on ? theme.color.brand : theme.color.border,
              }}
            >
              <Text
                variant="caption"
                style={{ fontWeight: '700', color: on ? theme.color.onBrand : theme.color.text }}
              >
                {`${p.label} (${p.n})`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {visible.length === 0 ? (
        <StandardCard style={{ padding: 14, borderRadius: 12, flexDirection: 'row', gap: 10 }}>
          <IconDisc ink={GREEN} size={36}>
            <Ionicons name="checkmark" size={iconSize.base} color={GREEN} />
          </IconDisc>
          <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {pill === 'all' ? c.ovAllClear : c.tkNone}
            </Text>
          </View>
        </StandardCard>
      ) : (
        visible.map((s) => (
          <StandardCard
            key={s.key}
            style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, gap: 4 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name={s.icon} size={iconSize.md} color={s.ink} />
              <Text
                variant="title"
                accessibilityRole="header"
                style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', color: s.ink }}
              >
                {`${s.title} (${counts[s.key]})`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${c.tkViewAll}: ${s.title}`}
                onPress={go}
                hitSlop={12}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
              >
                <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
                  {c.tkViewAll}
                </Text>
                <Ionicons
                  name={directionalIcon('chevron-forward')}
                  size={iconSize.sm}
                  color={theme.color.brand}
                />
              </Pressable>
            </View>
            {buckets[s.key].slice(0, 2).map((x, i) => {
              const st = status(x);
              const site = sites.find((p) => p.id === x.projectId)?.name;
              const owner = who(x.memberId);
              const crew = [x.memberId, ...(x.helperIds ?? [])]
                .map(who)
                .filter((m): m is NonNullable<typeof m> => !!m);
              const may = canChange(x);
              return (
                <View
                  key={x.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    minHeight: 60,
                    borderTopWidth: 1,
                    borderTopColor: theme.color.border,
                    marginTop: i === 0 ? 4 : 0,
                  }}
                >
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: false, disabled: !may }}
                    accessibilityLabel={fill(c.ovTaskDone, { title: x.title })}
                    disabled={!may}
                    hitSlop={10}
                    onPress={() => setStatus(x, 'done')}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      borderWidth: 1.5,
                      borderColor: may ? theme.color.textMuted : theme.color.border,
                    }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={x.title}
                    onPress={go}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <IconDisc ink={s.ink} size={34}>
                      <Ionicons name="checkbox-outline" size={iconSize.sm} color={s.ink} />
                    </IconDisc>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        variant="body"
                        numberOfLines={1}
                        style={{ fontSize: 14, fontWeight: '700' }}
                      >
                        {x.title}
                      </Text>
                      <Text variant="micro" tone="muted" numberOfLines={1}>
                        {site ?? (owner ? displayName(owner) : '')}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {crew.slice(0, 2).map((m, k) => (
                        <View key={m.id} style={{ marginStart: k === 0 ? 0 : -8 }}>
                          <PersonAvatar
                            member={m}
                            name={displayName(m)}
                            ghost={isGhost(m)}
                            size={24}
                            tint={TINTS[k % 6]}
                          />
                        </View>
                      ))}
                      {crew.length > 2 ? (
                        <Text variant="micro" tone="muted" style={{ marginStart: 4 }}>
                          {fill(c.tkMore, { n: crew.length - 2 })}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Pillbox label={st.label} ink={st.ink} />
                      <Text variant="micro" tone="muted">
                        {formatWorkTime(x.day, x.dueTime ?? null, today, locale, t.calendar.today)}
                      </Text>
                    </View>
                  </Pressable>
                  {may ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${c.tkMenu}: ${x.title}`}
                      hitSlop={8}
                      onPress={(e: GestureResponderEvent) =>
                        (e.currentTarget as unknown as View).measureInWindow(
                          (ax, ay, width, height) =>
                            setMenu({ task: x, anchor: { x: ax, y: ay, width, height } }),
                        )
                      }
                    >
                      <Ionicons
                        name="ellipsis-vertical"
                        size={iconSize.sm}
                        color={theme.color.textMuted}
                      />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </StandardCard>
        ))
      )}
      <OverflowMenu
        visible={menu !== null}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? null}
        items={menuItems}
      />
    </View>
  );
}

/** The "12 members" and "2 sites" chips under the company header. */
export function CompanyChips({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const sites = useCompanyProjects(groupId);
  if (!view.ready) return null;
  const members = view.members.filter((m) => !m.left_at).length;
  const chips: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
    { icon: 'people-outline', text: plural(locale, members, t.memberCount) },
    ...(sites.length > 0
      ? [
          {
            icon: 'business-outline' as const,
            text: plural(locale, sites.length, t.company.tkSites),
          },
        ]
      : []),
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {chips.map((x) => (
        <View
          key={x.icon}
          accessible
          accessibilityLabel={x.text}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 10,
            height: 30,
            borderRadius: 15,
            borderWidth: 1,
            borderColor: theme.color.border,
            backgroundColor: theme.color.surface,
          }}
        >
          <Ionicons name={x.icon} size={iconSize.sm} color={theme.color.textMuted} />
          <Text variant="caption" style={{ fontWeight: '600' }}>
            {x.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** All owner shortcuts in one wrapping grid, 4 a row: each opens the screen that already does it. */
export function QuickActions({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  if (view.suspended) return null;
  const go = (screen: string) => () => router.push(`/group/${groupId}/${screen}`);
  const actions = [
    { icon: 'card-outline', label: t.company.qaRecord, ink: GREEN, screen: 'company-wages' },
    {
      icon: 'document-attach-outline',
      label: t.company.ovAddBill,
      ink: LAVENDER,
      screen: 'company-vendors',
    },
    {
      icon: 'document-text-outline',
      label: t.company.ovCreateInvoice,
      ink: BLUE,
      screen: 'company-bill-form?type=bill',
    },
    { icon: 'checkbox-outline', label: t.company.qaAddTask, ink: GREEN, screen: 'company-work' },
    {
      icon: 'person-add-outline',
      label: t.company.tkAddClient,
      ink: BLUE,
      screen: 'company-client-add',
    },
    {
      icon: 'storefront-outline',
      label: t.company.tkAddVendor,
      ink: LAVENDER,
      screen: 'company-vendor-add',
    },
    {
      icon: 'cloud-upload-outline',
      label: t.company.tkUpload,
      ink: RED,
      screen: 'company-files',
    },
    // No reminder feature exists: this opens the calendar's new-event sheet.
    {
      icon: 'alarm-outline',
      label: t.company.qaAddReminder,
      ink: AMBER,
      screen: 'company-calendar?add=event',
    },
  ] as const;
  return (
    <StandardCard style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, gap: 8 }}>
      <Text variant="title" accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700' }}>
        {t.company.tkQuick}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
        {actions.map((a) => (
          <Pressable
            key={a.screen}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={go(a.screen)}
            style={{ width: '25%', alignItems: 'center', gap: 6, paddingVertical: 4 }}
          >
            <IconDisc ink={a.ink} size={42}>
              <Ionicons name={a.icon} size={iconSize.md} color={a.ink} />
            </IconDisc>
            <Text
              variant="micro"
              align="center"
              numberOfLines={2}
              style={{ color: theme.color.text }}
            >
              {a.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </StandardCard>
  );
}
