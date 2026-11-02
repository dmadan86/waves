/** Pure rules for follow-up reminders: which open follow-ups get a 09:00 local alarm, and what to add or cancel. */

export const REMINDER_HOUR = 9;

/** 09:00 local on `day`, or null when that moment has passed. */
export function reminderAt(day: string, now: Date): Date | null {
  const at = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), REMINDER_HOUR);
  return at.getTime() > now.getTime() ? at : null;
}

export interface ReminderTask {
  readonly id: string;
  readonly memberId: string;
  readonly day: string;
  readonly status: string;
  readonly clientId?: string | null;
}
export interface HeldReminder {
  readonly identifier: string;
  readonly taskId: string;
  readonly fireAt: number;
}

/** Idempotent by task id: keep a held alarm that already matches, replace a moved one, drop one nobody wants. */
export function planReminders<T extends ReminderTask>(
  tasks: readonly T[],
  myId: string | null,
  held: readonly HeldReminder[],
  now: Date,
): { add: { task: T; at: Date }[]; cancel: string[] } {
  const want = new Map<string, { task: T; at: Date }>();
  for (const task of tasks) {
    if (!myId || task.memberId !== myId || !task.clientId || task.status === 'done') continue;
    const at = reminderAt(task.day, now);
    if (at) want.set(task.id, { task, at });
  }
  const cancel: string[] = [];
  const kept = new Set<string>();
  for (const h of held) {
    const w = want.get(h.taskId);
    if (w && w.at.getTime() === h.fireAt && !kept.has(h.taskId)) kept.add(h.taskId);
    else cancel.push(h.identifier);
  }
  return { add: [...want.values()].filter((w) => !kept.has(w.task.id)), cancel };
}
