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
