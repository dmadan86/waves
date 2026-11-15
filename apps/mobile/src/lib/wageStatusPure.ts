/** Pay wages: each person's status and the team's working days for a period. Pure. */

export type WageStatus = 'present' | 'leave' | 'absent';

interface Mark {
  readonly memberId: string;
  readonly day: string;
  readonly status: 'present' | 'half' | 'absent';
}
interface Leave {
  readonly memberId: string;
  readonly startDay: string;
  readonly endDay: string;
  readonly status: 'pending' | 'approved' | 'rejected';
}

/** Leave: approved leave overlaps the period. Absent: no worked days (workedDaysText is ''). Else present. */
export function wageStatus(
  memberId: string,
  workedDays: string,
  leave: readonly Leave[],
  start: string,
  end: string,
): WageStatus {
  if (
    leave.some(
      (l) =>
        l.memberId === memberId &&
        l.status === 'approved' &&
        l.startDay <= end &&
        l.endDay >= start,
    )
  )
    return 'leave';
  return workedDays.trim() === '' || Number(workedDays) === 0 ? 'absent' : 'present';
}

/** Days in the period on which at least one of these people was marked present or half. */
export function teamWorkingDays(
  marks: Iterable<Mark>,
  memberIds: ReadonlySet<string>,
  start: string,
  end: string,
): number {
  const days = new Set<string>();
  for (const m of marks)
    if (memberIds.has(m.memberId) && m.day >= start && m.day <= end && m.status !== 'absent')
      days.add(m.day);
  return days.size;
}
