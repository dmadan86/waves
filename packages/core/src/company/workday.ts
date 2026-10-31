/** Attendance and daily work: tiny pure helpers shared by the screens, the wage run and the Pending counts. */

export type AttendanceStatus = 'present' | 'half' | 'absent';
export type WorkStatus = 'todo' | 'doing' | 'done' | 'blocked';

export interface AttendanceMark {
  readonly memberId: string;
  readonly day: string;
  readonly status: AttendanceStatus;
}
export interface WorkTaskLite {
  readonly memberId: string;
  readonly day: string;
  readonly status: WorkStatus;
}

const WEIGHT: Record<AttendanceStatus, number> = { present: 100, half: 50, absent: 0 };

/** One tap cycles: unmarked -> present -> half -> absent -> unmarked (null). */
export function nextAttendance(
  current: AttendanceStatus | null | undefined,
): AttendanceStatus | null {
  if (!current) return 'present';
  return current === 'present' ? 'half' : current === 'half' ? 'absent' : null;
}

/** Worked days for a person in [start, end] (inclusive ISO days) as the wage run's day text: "4.5"; "" when nothing counts. */
export function attendanceDaysText(
  marks: Iterable<AttendanceMark>,
  memberId: string,
  start: string,
  end: string,
): string {
  let hundredths = 0;
  for (const m of marks) {
    if (m.memberId === memberId && m.day >= start && m.day <= end) hundredths += WEIGHT[m.status];
  }
  if (hundredths === 0) return '';
  const whole = Math.floor(hundredths / 100);
  return hundredths % 100 === 0 ? String(whole) : `${whole}.5`;
}

export interface WorkdayCounts {
  /** Tasks marked Blocked (any day) that are still blocked. */
  readonly blocked: number;
  /** People in `people` with no attendance mark on `today`. */
  readonly unmarked: number;
}

/** Counts for the Pending screen. `people` = the ones the viewer may mark (owner: all, manager: team). */
export function workdayCounts(
  people: readonly string[],
  marks: Iterable<AttendanceMark>,
  tasks: readonly WorkTaskLite[],
  today: string,
): WorkdayCounts {
  const marked = new Set<string>();
  for (const m of marks) if (m.day === today) marked.add(m.memberId);
  return {
    blocked: tasks.filter((t) => t.status === 'blocked').length,
    unmarked: people.filter((id) => !marked.has(id)).length,
  };
}

export interface CalendarPayRule {
  readonly holidays: readonly { readonly startDay: string; readonly endDay: string }[];
  readonly leave: readonly {
    readonly memberId: string;
    readonly startDay: string;
    readonly endDay: string;
    readonly halfDay: boolean;
    readonly kind: 'casual' | 'sick' | 'other';
    readonly status: 'pending' | 'approved' | 'rejected';
  }[];
  /** Company setting "Paid holidays" (default on). */
  readonly paidHolidays: boolean;
  /** Company setting "Paid sick/casual leave" (default off); "other" leave is never paid. */
  readonly paidLeave: boolean;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Wage days for [start, end] from attendance plus the calendar. Per day, first match wins:
 *  1. an attendance mark (present 1, half 0.5, absent 0) - the owner's/manager's word is final;
 *  2. approved leave: 0 (absent), or when "Paid sick/casual leave" is on and the kind is casual/sick,
 *     1 day (0.5 for a half-day);
 *  3. a holiday: 1 when "Paid holidays" is on, else 0;
 *  4. otherwise 0 (unmarked).
 * Pending and rejected leave never counts. Returns "" when nothing counts, like attendanceDaysText.
 */
export function workedDaysText(
  marks: Iterable<AttendanceMark>,
  memberId: string,
  start: string,
  end: string,
  rule: CalendarPayRule,
): string {
  const marked = new Map<string, AttendanceStatus>();
  for (const m of marks)
    if (m.memberId === memberId && m.day >= start && m.day <= end) marked.set(m.day, m.status);
  const leave = rule.leave.filter((l) => l.memberId === memberId && l.status === 'approved');
  let hundredths = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const mark = marked.get(day);
    if (mark) {
      hundredths += WEIGHT[mark];
      continue;
    }
    const l = leave.find((x) => x.startDay <= day && day <= x.endDay);
    if (l) {
      if (rule.paidLeave && l.kind !== 'other') hundredths += l.halfDay ? 50 : 100;
      continue;
    }
    if (rule.paidHolidays && rule.holidays.some((h) => h.startDay <= day && day <= h.endDay))
      hundredths += 100;
  }
  if (hundredths === 0) return '';
  const whole = Math.floor(hundredths / 100);
  return hundredths % 100 === 0 ? String(whole) : `${whole}.5`;
}
