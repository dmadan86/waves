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

export function formatWorkTime(day: string, dueTime: string | null, today: string, locale: string) {
  if (!dueTime)
    return day === today
      ? 'Today'
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
  return `${day === today ? 'Today' : new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${time}`;
}
