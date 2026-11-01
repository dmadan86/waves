/** Pure rules behind the company Home blocks: greeting, task counts, "needs your attention" rows, "coming up" cards. */

export type Greeting = 'morning' | 'afternoon' | 'evening';

export const greetingFor = (hour: number): Greeting =>
  hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

export interface HomeTask {
  readonly day: string;
  readonly title: string;
  readonly status: string;
  readonly dueTime: string | null;
}

export interface TaskFacts {
  /** Every task not done (blocked ones included). */
  readonly open: number;
  readonly blocked: readonly string[];
  /** Not done, not blocked, and its day (or today's due time) has passed; oldest first. */
  readonly overdue: readonly HomeTask[];
  /** Not done, scheduled from today to six days ahead. */
  readonly dueThisWeek: number;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** `hhmm` is the local time now, "HH:MM". */
export function taskFacts(tasks: readonly HomeTask[], today: string, hhmm: string): TaskFacts {
  const end = addDays(today, 6);
  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open
    .filter(
      (t) =>
        t.status !== 'blocked' &&
        (t.day < today || (t.day === today && !!t.dueTime && t.dueTime.slice(0, 5) < hhmm)),
    )
    .sort((a, b) => a.day.localeCompare(b.day) || (a.dueTime ?? '').localeCompare(b.dueTime ?? ''));
  return {
    open: open.length,
    blocked: open.filter((t) => t.status === 'blocked').map((t) => t.title),
    overdue,
    dueThisWeek: open.filter((t) => t.day >= today && t.day <= end).length,
  };
}

export type NeedRow =
  | { kind: 'blocked'; n: number; titles: readonly string[] }
  | { kind: 'approve'; n: number; total: bigint }
  | { kind: 'overdue'; n: number; first: HomeTask };

/** Rows with something in them, in the mockup's order; the badge counts rows, and no rows means all clear. */
export function buildNeedRows(
  f: TaskFacts,
  approvals: { count: number; total: bigint },
): NeedRow[] {
  const rows: NeedRow[] = [];
  if (f.blocked.length > 0) rows.push({ kind: 'blocked', n: f.blocked.length, titles: f.blocked });
  if (approvals.count > 0)
    rows.push({ kind: 'approve', n: approvals.count, total: approvals.total });
  if (f.overdue[0]) rows.push({ kind: 'overdue', n: f.overdue.length, first: f.overdue[0] });
  return rows;
}

export interface ComingSource {
  readonly title: string;
  readonly day: string;
  readonly time: string | null;
}
export type ComingCard =
  | { kind: 'payroll'; title: string; day: string; time: string | null }
  | { kind: 'event'; title: string; day: string; time: string | null }
  | { kind: 'tasks'; n: number }
  | { kind: 'approvals'; n: number };

/** Up to three cards: payroll (else the next calendar event), tasks due this week, claims waiting for the viewer. */
export function buildComingUp(
  payroll: ComingSource | null,
  nextEvent: ComingSource | null,
  dueTasks: number,
  approvals: number,
): ComingCard[] {
  const first = payroll ?? nextEvent;
  return [
    ...(first ? [{ kind: payroll ? 'payroll' : 'event', ...first } as ComingCard] : []),
    ...(dueTasks > 0 ? [{ kind: 'tasks', n: dueTasks } as ComingCard] : []),
    ...(approvals > 0 ? [{ kind: 'approvals', n: approvals } as ComingCard] : []),
  ];
}
