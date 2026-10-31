import { ReadOnlyWhenSuspended } from '@/components/company/SuspendedBanner';
import { useCallback, useState, type ReactNode } from 'react';
import { randomUUID } from 'expo-crypto';
import { ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { CompanyWorkSetPayload } from '@waves/core';
import { useDepartments } from '@/data/companyDepartments';
import { Text } from '@waves/ui';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { ScenicBody } from '@/components/standard';
import type { MenuAnchor } from '@/components/SortMenu';
import { useClaimFab } from '@/lib/fabOverride';
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
import { countWork, filterWork, type WorkChip } from '@/lib/companyWork';
import { WorkTaskSections } from './WorkTaskSections';
import { AddTaskSheet } from './AddTaskSheet';
import { WorkFiltersAndDraftSheet } from './WorkFiltersAndDraftSheet';
import { WorkTaskSheets } from './WorkTaskSheets';
import { WorkChips, WorkToolbar } from './WorkSummaryControls';

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
  embedded = false,
}: {
  groupId: string;
  /** A header for the standalone (non-manager) view; the Team shell draws its own. */
  header?: ReactNode;
  /** Inside the Team shell: no header of its own. */
  embedded?: boolean;
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
  const clearance = useBottomClearance();
  const today = todayIso();
  const maxDay = shift(today, 7);
  const [day, setDay] = useState(today);
  const [draft, setDraft] = useState<Payload | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [menu, setMenu] = useState<{ id: string; anchor: MenuAnchor | null } | null>(null);
  const [sortAnchor, setSortAnchor] = useState<MenuAnchor | 'open' | null>(null);
  const [byTitle, setByTitle] = useState(false);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [reasonAfterClose, setReasonAfterClose] = useState<string | null>(null);
  const [field, setField] = useState<{ taskId: string; kind: 'note' | 'blockedReason' } | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [scope, setScope] = useState<'mine' | 'team'>(access.isEmployee ? 'mine' : 'team');
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<WorkChip>('all');
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
  const sortedTasks = [...visibleTasks].sort((a, b) =>
    byTitle
      ? a.title.localeCompare(b.title, locale)
      : (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
        a.title.localeCompare(b.title, locale),
  );
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
  const menuTask = tasks.find((task) => task.id === menu?.id);
  const items: OverflowMenuItem[] =
    menuTask && allowedPerson(menuTask.memberId) && canChange(menuTask) && !busy
      ? [
          {
            icon: 'create-outline',
            label: t.company.workEdit,
            onPress: () => setDraft(payload(menuTask)),
          },
          {
            icon: 'swap-horizontal-outline',
            label: t.company.workStatus,
            onPress: () => setStatusId(menuTask.id),
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
  const openAdd = () => {
    if (busy || access.people.length === 0 || day > maxDay) return;
    setAddKey((key) => key + 1);
    setAddOpen(true);
  };
  // Embedded in Team, the company bar's round + adds a task here instead of a ledger entry.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useClaimFab(embedded && focused && access.canManage, t.company.workAdd, openAdd);
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
        <ScenicBody flush={embedded}>
          <ReadOnlyWhenSuspended groupId={id}>
            {!access.enabled ? (
              <Text tone="muted">{t.company.attendanceEmpty}</Text>
            ) : (
              <>
                <WorkToolbar
                  dayLabel={new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                  onDay={() => setDateOpen(true)}
                  query={query}
                  onQueryChange={setQuery}
                  onSort={(a) => setSortAnchor(a ?? 'open')}
                />
                <WorkChips
                  value={chip}
                  onChange={setChip}
                  chips={[
                    { key: 'all', label: t.company.workAll },
                    { key: 'todo', label: t.company.workTodo },
                    { key: 'doing', label: t.company.workDoing },
                    { key: 'done', label: t.company.workDone },
                    ...(counts.blocked
                      ? [{ key: 'blocked' as const, label: t.company.workBlocked }]
                      : []),
                  ]}
                />
                <WorkTaskSections
                  groupId={id}
                  tasks={sortedTasks}
                  today={today}
                  people={people}
                  locale={locale}
                  canManage={access.canManage}
                  busy={busy}
                  canChange={canChange}
                  onChangeStatus={changeStatus}
                  onOpen={(task) =>
                    access.canManage && canChange(task)
                      ? setDraft(payload(task))
                      : setStatusId(task.id)
                  }
                  onMenu={(task, anchor) => setMenu({ id: task.id, anchor })}
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
      <OverflowMenu
        visible={menu !== null}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? null}
        items={items}
      />
      <OverflowMenu
        visible={sortAnchor !== null}
        onClose={() => setSortAnchor(null)}
        anchor={sortAnchor === 'open' ? null : sortAnchor}
        items={[
          {
            icon: 'text-outline',
            label: t.company.workSortTitle,
            toggle: { value: byTitle, onChange: setByTitle },
          },
          ...(access.canManage
            ? [
                {
                  icon: 'person-outline' as const,
                  label: t.company.workMineTasks,
                  toggle: {
                    value: scope === 'mine',
                    onChange: (on: boolean) => setScope(on ? 'mine' : 'team'),
                  },
                },
              ]
            : []),
          {
            icon: 'filter-outline',
            label: t.company.workFilter,
            onPress: () => setFilterOpen(true),
          },
        ]}
      />
      <AddTaskSheet
        key={addKey}
        groupId={id}
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        people={access.people}
        defaultMemberIds={
          personFilter && allowedPerson(personFilter)
            ? [personFilter]
            : access.people.length === 1
              ? access.people.map((p) => p.id)
              : []
        }
        defaultDay={day}
        today={today}
        maxDay={maxDay}
        onSaved={setDay}
      />
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
