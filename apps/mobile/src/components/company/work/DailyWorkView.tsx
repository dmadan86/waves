import { ReadOnlyWhenSuspended } from '@/components/company/SuspendedBanner';
import { useCallback, useState, type ReactNode } from 'react';
import { randomUUID } from 'expo-crypto';
import { ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { CompanyWorkSetPayload } from '@waves/core';
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
import { filterWork, groupWorkTasks, type WorkMode } from '@/lib/companyWork';
import { WorkTaskSections } from './WorkTaskSections';
import { AddTaskSheet } from './AddTaskSheet';
import { WorkFiltersAndDraftSheet } from './WorkFiltersAndDraftSheet';
import { WorkTaskSheets } from './WorkTaskSheets';
import { WorkToolbar } from './WorkSummaryControls';

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
  const save = useSetWorkTask(id);
  const remove = useRemoveWorkTask(id);
  const { t, locale } = useStrings();
  const clearance = useBottomClearance();
  const today = todayIso();
  const [draft, setDraft] = useState<Payload | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [menu, setMenu] = useState<{ id: string; anchor: MenuAnchor | null } | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<MenuAnchor | 'open' | null>(null);
  const [mode, setMode] = useState<WorkMode>('date');
  const [statusId, setStatusId] = useState<string | null>(null);
  const [reasonAfterClose, setReasonAfterClose] = useState<string | null>(null);
  const [field, setField] = useState<{ taskId: string; kind: 'note' | 'blockedReason' } | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [scope, setScope] = useState<'mine' | 'team'>(access.isEmployee ? 'mine' : 'team');
  const [query, setQuery] = useState('');
  const [siteFilter, setSiteFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const busy = save.isPending || remove.isPending;
  const allowedPerson = (memberId: string) =>
    access.canManage && access.people.some((p) => p.id === memberId);
  const canChange = (task: MirrorWorkTask) =>
    access.enabled &&
    (allowedPerson(task.memberId) || (access.isEmployee && task.memberId === access.me?.id));
  const personName = (memberId: string) => {
    const p = access.people.find((person) => person.id === memberId) ?? access.me;
    return p ? displayName(p) : '';
  };
  const ownTasks = tasks.filter(
    (task) =>
      (allowedPerson(task.memberId) || (access.isEmployee && task.memberId === access.me?.id)) &&
      (scope === 'team' || task.memberId === company.me?.id),
  );
  const visibleTasks = filterWork(ownTasks, {
    search: query,
    siteId: siteFilter,
    personName,
    siteName: (projectId) => projects.find((project) => project.id === projectId)?.name ?? '',
  });
  const grouped = groupWorkTasks(visibleTasks, {
    mode: access.canManage ? mode : 'date',
    today,
    personName,
  });
  const people = access.isEmployee && access.me ? [access.me] : access.people;
  const write = (next: Payload, onSuccess?: () => void) => {
    const current = tasks.find((task) => task.id === next.taskId);
    if (
      !access.enabled ||
      busy ||
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
          ...(menuTask.status !== 'done'
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
    if (busy || access.people.length === 0) return;
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
                  mode={access.canManage ? mode : null}
                  onMode={setMode}
                  query={query}
                  onQueryChange={setQuery}
                  onMore={(a) => setMoreAnchor(a ?? 'open')}
                />
                <WorkTaskSections
                  groupId={id}
                  sections={grouped.sections}
                  done={grouped.done}
                  mode={access.canManage ? mode : 'date'}
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
        visible={moreAnchor !== null}
        onClose={() => setMoreAnchor(null)}
        anchor={moreAnchor === 'open' ? null : moreAnchor}
        items={[
          {
            icon: 'location-outline',
            label: t.company.workSiteFilter,
            hint: sites.find((site) => site.id === siteFilter)?.name,
            onPress: () => setFilterOpen(true),
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
        ]}
      />
      <AddTaskSheet
        key={addKey}
        groupId={id}
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        people={access.people}
        defaultMemberIds={access.people.length === 1 ? access.people.map((p) => p.id) : []}
        today={today}
      />
      <WorkFiltersAndDraftSheet
        groupId={id}
        filterOpen={filterOpen}
        setFilterOpen={setFilterOpen}
        sites={sites}
        siteFilter={siteFilter}
        setSiteFilter={setSiteFilter}
        canManage={access.canManage}
        people={access.people}
        draft={draft}
        setDraft={setDraft}
        busy={busy}
        error={error}
        allowedPerson={allowedPerson}
        write={write}
      />
      <WorkTaskSheets
        groupId={id}
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
