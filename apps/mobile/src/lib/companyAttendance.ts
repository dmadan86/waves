import type { AttendanceStatus, MirrorAttendance } from '@/data/companyWorkday';

export function attendanceCounts(rows: readonly MirrorAttendance[]) {
  return rows.reduce(
    (counts, row) => {
      counts[row.status] += 1;
      return counts;
    },
    { present: 0, half: 0, absent: 0 },
  );
}

export function weekDays(iso: string): string[] {
  const date = new Date(`${iso}T00:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(date);
    day.setUTCDate(date.getUTCDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

export function stepIso(iso: string, amount: number, unit: 'day' | 'month') {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (unit === 'day') date.setUTCDate(date.getUTCDate() + amount);
  else date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}

export function markAllTargets(
  people: readonly { id: string }[],
  marks: ReadonlyMap<string, unknown>,
  day: string,
) {
  return people.filter((person) => !marks.has(`${person.id}|${day}`)).map((person) => person.id);
}

export function attendanceStatusLetter(status?: AttendanceStatus) {
  return status === 'present' ? 'P' : status === 'half' ? '½' : status === 'absent' ? 'A' : '';
}

/** The day's counts for these people, read from the same marks map as the rows. */
export function dayCounts(
  people: readonly { id: string }[],
  marks: ReadonlyMap<string, MirrorAttendance>,
  day: string,
) {
  return attendanceCounts(
    people.map((p) => marks.get(`${p.id}|${day}`)).filter((m): m is MirrorAttendance => !!m),
  );
}

/** "+2" / "-1" / "0", digits in the viewer's numerals. */
export function signedDelta(delta: number, locale = 'en'): string {
  let digits = String(Math.abs(delta));
  try {
    digits = new Intl.NumberFormat(locale).format(Math.abs(delta));
  } catch {
    // A locale Intl will not take still gets plain digits.
  }
  return delta > 0 ? `+${digits}` : delta < 0 ? `-${digits}` : digits;
}

/** Whether a rise in this figure is good news: more present is, more half days or absences are not. */
export function riseIsGood(kind: 'present' | 'half' | 'absent' | 'total'): boolean | null {
  return kind === 'present' ? true : kind === 'total' ? null : false;
}

/** The attendance list's status filter. Present covers half days, as the Overview counts them. */
export function matchesStatus(
  mark: 'present' | 'half' | 'absent' | 'leave' | undefined,
  filter: 'present' | 'half' | 'absent' | 'leave' | 'unmarked',
): boolean {
  return filter === 'unmarked'
    ? !mark
    : filter === 'present'
      ? mark === 'present' || mark === 'half'
      : mark === filter;
}
