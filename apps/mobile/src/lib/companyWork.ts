import type { CompanyWorkSetPayload } from '@waves/core';
import type { MirrorWorkTask } from '@/data/companyWorkday';

export type WorkChip = 'all' | 'todo' | 'doing' | 'done' | 'blocked';
export function countWork(tasks: readonly MirrorWorkTask[]) {
  return {
    total: tasks.length,
    done: tasks.filter((task) => task.status === 'done').length,
    doing: tasks.filter((task) => task.status === 'doing').length,
    pending: tasks.filter((task) => task.status === 'todo' || task.status === 'blocked').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
  };
}

export function filterWork(
  tasks: readonly MirrorWorkTask[],
  options: {
    search?: string;
    siteId?: string | null;
    personId?: string | null;
    departmentId?: string | null;
    departmentIdForPerson?: (id: string) => string | null | undefined;
    chip?: WorkChip;
    personName?: (id: string) => string;
    siteName?: (id: string | null) => string;
  },
): MirrorWorkTask[] {
  const query = options.search?.trim().toLocaleLowerCase() ?? '';
  return tasks.filter((task) => {
    if (options.siteId && task.projectId !== options.siteId) return false;
    if (options.personId && task.memberId !== options.personId) return false;
    if (
      options.departmentId &&
      options.departmentIdForPerson?.(task.memberId) !== options.departmentId
    )
      return false;
    if (options.chip && options.chip !== 'all' && task.status !== options.chip) return false;
    return (
      !query ||
      [task.title, options.personName?.(task.memberId), options.siteName?.(task.projectId)].some(
        (value) => value?.toLocaleLowerCase().includes(query),
      )
    );
  });
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

/** Most photos on one new task (each assignee's task gets its own copy of the upload). */
export const MAX_TASK_PHOTOS = 4;

export type AddTaskError = 'title' | 'people' | 'day';

/**
 * What stops the Add task sheet from saving, checked in the app before anything is queued.
 * `allowed` is who the viewer may assign to (owner: everyone, manager: their team); the deadline is
 * the task's day, which for a new task is today up to the same week-ahead limit the server holds.
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
  }));
}
