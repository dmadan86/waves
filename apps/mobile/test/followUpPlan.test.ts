import { describe, expect, it } from 'vitest';

import { planReminders, reminderAt, type ReminderTask } from '../src/lib/followUpPlan';

const now = new Date(2026, 10, 2, 10, 0);
const task = (id: string, day: string, over: Partial<ReminderTask> = {}): ReminderTask => ({
  id,
  memberId: 'me',
  day,
  status: 'todo',
  clientId: 'c',
  ...over,
});

describe('follow-up reminders', () => {
  it('fires at 09:00 local and never in the past', () => {
    expect(reminderAt('2026-11-03', now)?.getHours()).toBe(9);
    expect(reminderAt('2026-11-02', now)).toBeNull();
    expect(reminderAt('2026-11-01', now)).toBeNull();
  });
  it('schedules only my open client follow-ups', () => {
    const p = planReminders(
      [
        task('a', '2026-11-03'),
        task('b', '2026-11-03', { memberId: 'x' }),
        task('c', '2026-11-03', { status: 'done' }),
        task('d', '2026-11-03', { clientId: null }),
      ],
      'me',
      [],
      now,
    );
    expect(p.add.map((a) => a.task.id)).toEqual(['a']);
  });
  it('is idempotent, reschedules a moved day and cancels done or removed ones', () => {
    const at = reminderAt('2026-11-03', now)!.getTime();
    const held = [
      { identifier: 'h1', taskId: 'a', fireAt: at },
      { identifier: 'h2', taskId: 'b', fireAt: at },
      { identifier: 'h3', taskId: 'gone', fireAt: at },
    ];
    const p = planReminders([task('a', '2026-11-03'), task('b', '2026-11-04')], 'me', held, now);
    expect(p.add.map((a) => a.task.id)).toEqual(['b']);
    expect(p.cancel.sort()).toEqual(['h2', 'h3']);
  });
});
