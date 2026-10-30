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
