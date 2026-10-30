import { ReadOnlyWhenSuspended } from '@/components/company/SuspendedBanner';
import { useState, type ReactNode } from 'react';
import { randomUUID } from 'expo-crypto';
import { Pressable, ScrollView, View } from 'react-native';
import type { CompanyWorkSetPayload } from '@waves/core';
import { useDepartments, departmentName } from '@/data/companyDepartments';
import { Button, Text, useTheme } from '@waves/ui';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { ScenicBody, SegmentedPills } from '@/components/standard';
import { useCompanyEntries, useCompanyProjects } from '@/data/companyEntries';
import {
  useRemoveWorkTask,
  useSetWorkTask,
  useWorkdayAccess,
  useWorkTasks,
  type MirrorWorkTask,
} from '@/data/companyWorkday';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { countWork, filterWork } from '@/lib/companyWork';
import { WorkTaskSections } from './WorkTaskSections';
import { WorkFiltersAndDraftSheet } from './WorkFiltersAndDraftSheet';
import { WorkTaskSheets } from './WorkTaskSheets';
import { WorkSearchControl, WorkStatTiles } from './WorkSummaryControls';

type Payload = CompanyWorkSetPayload;
function shift(iso: string, n: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
function payload(task: MirrorWorkTask): Payload {
  return {
    taskId: task.id,
    memberId: task.memberId,
    day: task.day,
    title: task.title,
    projectId: task.projectId,
    status: task.status,
    blockedReason: task.blockedReason,
    note: task.note,
    dueTime: task.dueTime ?? null,
  };
}

export default function DailyWorkView({
  groupId: id,
  header,
  segment,
}: {
  groupId: string;
  header?: ReactNode;
  /** The Attendance | Daily work switch, first in the body. */
  segment?: ReactNode;
}) {
  const access = useWorkdayAccess(id);
  const tasks = useWorkTasks(id);
  const projects = useCompanyProjects(id);
  const company = useCompanyEntries(id);
  const sites = projects.filter((p) => !p.archived_at);
  const departments = useDepartments(id);
  const save = useSetWorkTask(id);
  const remove = useRemoveWorkTask(id);
  const { t, locale } = useStrings();
  const theme = useTheme();
  const clearance = useBottomClearance();
  const today = todayIso();
  const maxDay = shift(today, 7);
  const [day, setDay] = useState(today);
  const [draft, setDraft] = useState<Payload | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [reasonAfterClose, setReasonAfterClose] = useState<string | null>(null);
  const [field, setField] = useState<{ taskId: string; kind: 'note' | 'blockedReason' } | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [scope, setScope] = useState<'mine' | 'team'>(access.isEmployee ? 'mine' : 'team');
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<'all' | 'todo' | 'doing' | 'done' | 'blocked'>('all');
  const [siteFilter, setSiteFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const busy = save.isPending || remove.isPending;
  const allowedPerson = (memberId: string) =>
    access.canManage && access.people.some((p) => p.id === memberId);
  const canChange = (task: MirrorWorkTask) =>
    access.enabled &&
    task.day <= maxDay &&
    (allowedPerson(task.memberId) || (access.isEmployee && task.memberId === access.me?.id));
  const dayTasks = tasks.filter(
    (task) =>
      task.day === day &&
      (allowedPerson(task.memberId) || (access.isEmployee && task.memberId === access.me?.id)) &&
      (scope === 'team' || task.memberId === company.me?.id),
  );
  const counts = countWork(dayTasks);
  const visibleTasks = filterWork(dayTasks, {
    search: query,
    siteId: siteFilter,
    personId: personFilter,
    departmentId: departmentFilter,
    departmentIdForPerson: (memberId) =>
      access.people.find((person) => person.id === memberId)?.department_id ?? null,
    chip,
    personName: (memberId) => {
      const p = access.people.find((person) => person.id === memberId) ?? access.me;
      return p ? displayName(p) : '';
    },
    siteName: (projectId) => projects.find((project) => project.id === projectId)?.name ?? '',
  });
  const people = access.isEmployee && access.me ? [access.me] : access.people;
  const write = (next: Payload, onSuccess?: () => void) => {
    const current = tasks.find((task) => task.id === next.taskId);
    if (
      !access.enabled ||
      busy ||
      next.day > maxDay ||
      !next.title.trim() ||
      next.title.length > 200 ||
      (next.note?.length ?? 0) > 200 ||
      (next.blockedReason?.length ?? 0) > 120 ||
      (next.status === 'blocked' && !next.blockedReason?.trim())
    )
      return;
    if (!allowedPerson(next.memberId)) {
      if (
        !current ||
        !access.isEmployee ||
        current.memberId !== access.me?.id ||
        next.memberId !== current.memberId ||
        next.day !== current.day ||
        next.title !== current.title ||
        next.projectId !== current.projectId
      )
        return;
    }
    setError(false);
    save.mutate(next, { onSuccess, onError: () => setError(true) });
  };
  const statusOptions = [
    { value: 'todo' as const, label: t.company.workTodo },
    { value: 'doing' as const, label: t.company.workDoing },
    { value: 'done' as const, label: t.company.workDone },
    { value: 'blocked' as const, label: t.company.workBlocked },
  ];
  const changeStatus = (task: MirrorWorkTask, status: Payload['status']) => {
    if (!canChange(task) || busy) return;
    if (status === 'blocked') {
      setStatusId(null);
      if (statusId !== null) setReasonAfterClose(task.id);
      else setField({ taskId: task.id, kind: 'blockedReason' });
    } else write({ ...payload(task), status, blockedReason: null });
  };
  const menuTask = tasks.find((task) => task.id === menuId);
  const items: OverflowMenuItem[] =
    menuTask && allowedPerson(menuTask.memberId) && canChange(menuTask) && !busy
      ? [
          {
            icon: 'create-outline',
            label: t.company.workEdit,
            onPress: () => setDraft(payload(menuTask)),
          },
          ...(menuTask.status !== 'done' && shift(menuTask.day, 1) <= maxDay
            ? [
                {
                  icon: 'copy-outline' as const,
                  label: t.company.workRepeat,
                  onPress: () =>
                    write({
                      ...payload(menuTask),
                      taskId: randomUUID(),
                      day: shift(menuTask.day, 1),
                      status: 'todo',
                      blockedReason: null,
                    }),
                },
              ]
            : []),
          {
            icon: 'trash-outline',
            label: t.company.workRemove,
            tone: 'danger',
            onPress: () => {
              if (!allowedPerson(menuTask.memberId) || busy) return;
              setError(false);
              remove.mutate({ taskId: menuTask.id }, { onError: () => setError(true) });
            },
          },
        ]
      : [];
  const fieldTask = tasks.find((task) => task.id === field?.taskId);
  const statusTask = tasks.find((task) => task.id === statusId);
  return (
    <>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 80 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {header}
        <ScenicBody>
          {segment}
          <ReadOnlyWhenSuspended groupId={id}>
            {!access.enabled ? (
              <Text tone="muted">{t.company.attendanceEmpty}</Text>
            ) : (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Button
                    label="‹"
                    accessibilityLabel={t.company.workPreviousDay}
                    variant="secondary"
                    repeatable
                    onPress={() => setDay(shift(day, -1))}
                  />
                  <Pressable onPress={() => setDateOpen(true)}>
                    <Text>
                      {new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </Text>
                  </Pressable>
                  <Button
                    label="›"
                    accessibilityLabel={t.company.workNextDay}
                    variant="secondary"
                    repeatable
                    disabled={day >= maxDay}
                    onPress={() => setDay(shift(day, 1))}
                  />
                </View>
                {access.canManage ? (
                  <SegmentedPills
                    options={[
                      { value: 'mine', label: t.company.workMineTasks },
                      { value: 'team', label: t.company.workTeam },
                    ]}
                    value={scope}
                    onChange={setScope}
                  />
                ) : null}
                {access.canManage ? (
                  <Button
                    label={`+ ${t.company.workAdd}`}
                    disabled={busy || access.people.length === 0 || day > maxDay}
                    onPress={() =>
                      setDraft({
                        taskId: randomUUID(),
                        memberId: access.people[0]?.id ?? '',
                        day,
                        title: '',
                        projectId: null,
                        dueTime: null,
                        status: 'todo',
                        blockedReason: null,
                        note: null,
                      })
                    }
                  />
                ) : null}
                <WorkStatTiles counts={counts} />
                <WorkSearchControl
                  query={query}
                  onQueryChange={setQuery}
                  onFilter={() => setFilterOpen(true)}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: theme.spacing.xs }}
                >
                  {(
                    [
                      'all',
                      'todo',
                      'doing',
                      'done',
                      ...(counts.blocked ? ['blocked'] : []),
                    ] as const
                  ).map((key) => {
                    const n =
                      key === 'all'
                        ? counts.total
                        : dayTasks.filter((task) => task.status === key).length;
                    const label =
                      key === 'all'
                        ? t.company.workAll
                        : key === 'todo'
                          ? t.company.workTodo
                          : key === 'doing'
                            ? t.company.workDoing
                            : key === 'done'
                              ? t.company.workDone
                              : t.company.workBlocked;
                    return (
                      <Button
                        key={key}
                        size="sm"
                        variant={chip === key ? 'primary' : 'secondary'}
                        label={`${label} (${n})`}
                        onPress={() => setChip(key as typeof chip)}
                      />
                    );
                  })}
                </ScrollView>
                <WorkTaskSections
                  tasks={visibleTasks}
                  people={people}
                  locale={locale}
                  canManage={access.canManage}
                  busy={busy}
                  canChange={canChange}
                  onChangeStatus={changeStatus}
                  onOpen={(task) => (access.canManage ? setMenuId(task.id) : setStatusId(task.id))}
                  departmentFor={(memberId) =>
                    departmentName(
                      departments,
                      people.find((p) => p.id === memberId)?.department_id,
                    )
                  }
                  siteName={(projectId) =>
                    projects.find((project) => project.id === projectId)?.name ?? ''
                  }
                />
              </>
            )}
            {error ? <Text tone="negative">{t.company.workSaveError}</Text> : null}
          </ReadOnlyWhenSuspended>
        </ScenicBody>
      </ScrollView>
      <OverflowMenu visible={menuId !== null} onClose={() => setMenuId(null)} items={items} />
      <WorkFiltersAndDraftSheet
        filterOpen={filterOpen}
        setFilterOpen={setFilterOpen}
        sites={sites}
        departments={departments}
        siteFilter={siteFilter}
        setSiteFilter={setSiteFilter}
        departmentFilter={departmentFilter}
        setDepartmentFilter={setDepartmentFilter}
        canManage={access.canManage}
        scope={scope}
        people={access.people}
        personFilter={personFilter}
        setPersonFilter={setPersonFilter}
        draft={draft}
        setDraft={setDraft}
        tasks={tasks}
        busy={busy}
        error={error}
        allowedPerson={allowedPerson}
        write={write}
      />
      <WorkTaskSheets
        dateOpen={dateOpen}
        setDateOpen={setDateOpen}
        day={day}
        setDay={setDay}
        today={today}
        maxDay={maxDay}
        statusId={statusId}
        setStatusId={setStatusId}
        statusTask={statusTask}
        statusOptions={statusOptions}
        changeStatus={changeStatus}
        reasonAfterClose={reasonAfterClose}
        setReasonAfterClose={setReasonAfterClose}
        setField={setField}
        field={field}
        fieldTask={fieldTask}
        busy={busy}
        error={error}
        canChange={canChange}
        write={write}
      />
    </>
  );
}
