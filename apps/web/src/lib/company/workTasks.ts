/** Pure task helpers, ported from the phone's lib/companyWork. */
import type { CompanyWorkSetPayload, TaskPriority } from '@waves/core';

import type { MirrorWorkTask } from './workday';

export type WorkMode = 'date' | 'person';
export interface WorkSection {
  key: string;
  kind: 'overdue' | 'day' | 'person';
  /** ISO day for a `day` section, member id for a `person` section. */
  ref: string;
  tasks: MirrorWorkTask[];
  alert: number;
  open: number;
}

export function filterWork(
  tasks: readonly MirrorWorkTask[],
  search: string,
  personName: (id: string) => string,
  siteName: (id: string | null) => string,
): MirrorWorkTask[] {
  const q = search.trim().toLocaleLowerCase();
  if (!q) return [...tasks];
  return tasks.filter(
    (t) =>
      (t.number !== null && String(t.number) === q.replace(/^#/, '')) ||
      [t.title, personName(t.memberId), siteName(t.projectId)].some((v) =>
        v.toLocaleLowerCase().includes(q),
      ),
  );
}

const RANK = { blocked: 0, doing: 1, todo: 2, done: 3 } as const;
const PRIORITY_RANK = { very_urgent: 0, urgent: 1, normal: 2 } as const;
const priorityRank = (p: TaskPriority | undefined) => PRIORITY_RANK[p ?? 'normal'];
/** The mark before a title: "!!" very urgent, "!" urgent, nothing for normal. */
export const priorityMark = (p: TaskPriority | undefined) =>
  p === 'very_urgent' ? '!!' : p === 'urgent' ? '!' : '';
function compareTasks(a: MirrorWorkTask, b: MirrorWorkTask): number {
  return (
    priorityRank(a.priority) - priorityRank(b.priority) ||
    RANK[a.status] - RANK[b.status] ||
    a.day.localeCompare(b.day) ||
    (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
    a.title.localeCompare(b.title)
  );
}

/** By date: Overdue, then a section per day. By person: a section per person. Done tasks before today fold into `done`. */
export function groupWorkTasks(
  tasks: readonly MirrorWorkTask[],
  options: { mode: WorkMode; today: string; personName: (id: string) => string },
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
  sections.sort((a, b) =>
    options.mode === 'person'
      ? options.personName(a.ref).localeCompare(options.personName(b.ref))
      : (a.kind === 'overdue' ? '' : a.ref).localeCompare(b.kind === 'overdue' ? '' : b.ref),
  );
  return { sections, done };
}

/** How far ahead a task may be set; the server's limit is the same. */
export function maxTaskDay(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 730);
  return date.toISOString().slice(0, 10);
}

export function shiftDay(iso: string, n: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export const MAX_TASK_PHOTOS = 4;

export function taskPayload(task: MirrorWorkTask): CompanyWorkSetPayload {
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
    priority: task.priority ?? 'normal',
  };
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
