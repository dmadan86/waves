import type { CompanyWorkSetPayload, TaskPriority } from '@waves/core';
import type { MirrorWorkTask } from '@/data/companyWorkday';

export function countWork(tasks: readonly MirrorWorkTask[]) {
  return {
    total: tasks.length,
    done: tasks.filter((task) => task.status === 'done').length,
    doing: tasks.filter((task) => task.status === 'doing').length,
    pending: tasks.filter((task) => task.status === 'todo' || task.status === 'blocked').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
  };
}

/** Search by title, person, site and task number ("#42" or "42"), and optionally one site. */
export function filterWork(
  tasks: readonly MirrorWorkTask[],
  options: {
    search?: string;
    siteId?: string | null;
    personName?: (id: string) => string;
    siteName?: (id: string | null) => string;
  },
): MirrorWorkTask[] {
  const query = options.search?.trim().toLocaleLowerCase() ?? '';
  return tasks.filter((task) => {
    if (options.siteId && task.projectId !== options.siteId) return false;
    return (
      !query ||
      (task.number !== null && String(task.number) === query.replace(/^#/, '')) ||
      [task.title, options.personName?.(task.memberId), options.siteName?.(task.projectId)].some(
        (value) => value?.toLocaleLowerCase().includes(query),
      )
    );
  });
}

export type EmptyTasks =
  { kind: 'search' } | { kind: 'mine'; blockedInTeam: number } | { kind: 'none' };
/** Why the task list is empty: a search, "mine" hiding the team's tasks, or truly nothing. */
export function emptyTasksState(options: {
  search: string;
  scope: 'mine' | 'team';
  teamTasks: readonly { status: string }[];
}): EmptyTasks {
  if (options.search.trim()) return { kind: 'search' };
  if (options.scope === 'mine' && options.teamTasks.length > 0)
    return {
      kind: 'mine',
      blockedInTeam: options.teamTasks.filter((task) => task.status === 'blocked').length,
    };
  return { kind: 'none' };
}

export type WorkMode = 'date' | 'person';
export interface WorkSection {
  key: string;
  kind: 'overdue' | 'day' | 'person';
  /** ISO day for a `day` section, member id for a `person` section. */
  ref: string;
  tasks: MirrorWorkTask[];
  /** Open tasks that are blocked or past their day (a person section's red count). */
  alert: number;
  /** Open (not done) tasks in the section. */
  open: number;
}

const RANK = { blocked: 0, doing: 1, todo: 2, done: 3 } as const;
const PRIORITY_RANK = { very_urgent: 0, urgent: 1, normal: 2 } as const;
/** Lower sorts first: very urgent, urgent, normal. */
export const priorityRank = (p: TaskPriority | undefined) => PRIORITY_RANK[p ?? 'normal'];
/** The mark shown before a title: "!!" very urgent, "!" urgent, nothing for normal. */
export const priorityMark = (p: TaskPriority | undefined) =>
  p === 'very_urgent' ? '!!' : p === 'urgent' ? '!' : '';
/** A not-done task before today. */
export const isLate = (task: Pick<MirrorWorkTask, 'status' | 'day'>, today: string) =>
  task.status !== 'done' && task.day < today;
/** The date line of a task: "Late · <date>" when late (the caller paints it grey, never red). */
export function workDueText(
  task: Pick<MirrorWorkTask, 'status' | 'day' | 'dueTime'>,
  today: string,
  locale: string,
  todayLabel: string,
  lateTemplate: string,
): string {
  const text = formatWorkTime(task.day, task.dueTime ?? null, today, locale, todayLabel);
  return isLate(task, today) ? lateTemplate.replace('{date}', text) : text;
}
/** Very urgent, urgent, normal; then blocked, doing, todo, done; then day, due time and title. */
function compareTasks(a: MirrorWorkTask, b: MirrorWorkTask): number {
  return (
    priorityRank(a.priority) - priorityRank(b.priority) ||
    RANK[a.status] - RANK[b.status] ||
    a.day.localeCompare(b.day) ||
    (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
    a.title.localeCompare(b.title)
  );
}

/**
 * The Tasks list. By date: Overdue (open, before today), then one section per day from today on.
 * By person: one section per person. Either way, done tasks from before today collapse into one
 * `done` tail; done tasks from today on stay in their section.
 */
export function groupWorkTasks(
  tasks: readonly MirrorWorkTask[],
  options: { mode: WorkMode; today: string; personName?: (id: string) => string },
): { sections: WorkSection[]; done: MirrorWorkTask[] } {
  const { today } = options;
  const done = tasks.filter((t) => t.status === 'done' && t.day < today).sort(compareTasks);
  const live = tasks.filter((t) => !(t.status === 'done' && t.day < today)).sort(compareTasks);
  const buckets = new Map<string, WorkSection>();
  for (const task of live) {
    const overdue = task.status !== 'done' && task.day < today;
    const [key, kind, ref] =
      options.mode === 'person'
        ? [`p:${task.memberId}`, 'person' as const, task.memberId]
        : overdue
          ? ['overdue', 'overdue' as const, '']
          : [`d:${task.day}`, 'day' as const, task.day];
    let section = buckets.get(key);
    if (!section) buckets.set(key, (section = { key, kind, ref, tasks: [], alert: 0, open: 0 }));
    section.tasks.push(task);
    if (task.status !== 'done') {
      section.open += 1;
      if (task.status === 'blocked' || overdue) section.alert += 1;
    }
  }
  const sections = [...buckets.values()];
  const name = (s: WorkSection) => options.personName?.(s.ref) ?? '';
  sections.sort((a, b) =>
    options.mode === 'person'
      ? name(a).localeCompare(name(b))
      : (a.kind === 'overdue' ? '' : a.ref).localeCompare(b.kind === 'overdue' ? '' : b.ref),
  );
  return { sections, done };
}

export function advanceWorkStatus(status: MirrorWorkTask['status']): MirrorWorkTask['status'] {
  return status === 'todo' ? 'doing' : status === 'doing' ? 'done' : 'todo';
}

export function formatWorkTime(
  day: string,
  dueTime: string | null,
  today: string,
  locale: string,
  todayLabel: string,
) {
  if (!dueTime)
    return day === today
      ? todayLabel
      : new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        });
  const [hour, minute] = dueTime.split(':').map(Number);
  const time = new Date(Date.UTC(2020, 0, 1, hour, minute)).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return `${day === today ? todayLabel : new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${time}`;
}

/** How far ahead a task may be set; the server's limit is the same. */
export function maxTaskDay(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 730);
  return date.toISOString().slice(0, 10);
}

/** Most photos on one new task (each assignee's task gets its own copy of the upload). */
export const MAX_TASK_PHOTOS = 4;

export type AddTaskError = 'title' | 'people' | 'day';

/**
 * What stops the Add task sheet from saving, checked in the app before anything is queued.
 * `allowed` is who the viewer may assign to (owner: everyone, manager: their team); the deadline is
 * the task's day, which for a new task is today up to `maxTaskDay` (the limit the server holds).
 */
export function addTaskError(input: {
  title: string;
  memberIds: readonly string[];
  allowed: readonly string[];
  day: string;
  today: string;
  maxDay: string;
}): AddTaskError | null {
  const title = input.title.trim();
  if (!title || title.length > 200) return 'title';
  if (input.memberIds.length === 0 || input.memberIds.some((id) => !input.allowed.includes(id)))
    return 'people';
  if (input.day < input.today || input.day > input.maxDay) return 'day';
  return null;
}

/** One task per selected person: same title and day, a fresh id each (`idFor` keeps them stable across retries). */
export function addTaskPayloads(input: {
  title: string;
  memberIds: readonly string[];
  day: string;
  priority?: TaskPriority;
  idFor: (memberId: string) => string;
}): CompanyWorkSetPayload[] {
  return [...new Set(input.memberIds)].map((memberId) => ({
    taskId: input.idFor(memberId),
    memberId,
    day: input.day,
    title: input.title.trim(),
    projectId: null,
    status: 'todo',
    blockedReason: null,
    note: null,
    dueTime: null,
    priority: input.priority ?? 'normal',
  }));
}
