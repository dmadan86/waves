import type { CompanyEntry, MirrorAttendance, MirrorWorkTask } from '@waves/core';

/** Anything recorded for this person (money, attendance, tasks): such a person is never removed, only marked not employed. */
export function hasHistory(
  memberId: string,
  entries: readonly CompanyEntry[],
  marks: ReadonlyMap<string, MirrorAttendance>,
  tasks: readonly MirrorWorkTask[],
): boolean {
  if (entries.some((e) => e.memberId === memberId)) return true;
  if (tasks.some((task) => task.memberId === memberId)) return true;
  for (const key of marks.keys()) if (key.startsWith(`${memberId}|`)) return true;
  return false;
}
