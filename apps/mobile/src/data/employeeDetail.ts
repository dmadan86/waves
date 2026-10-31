/** Pure helpers behind the employee detail screen: month counts, pay-due total, history check, shown dates. */

import { buildReimbursementPreview, isReimbursable, type CompanyEntry } from '@waves/core';

import type { MirrorAttendance, MirrorWorkTask } from '@/data/companyWorkday';

export interface MonthCounts {
  readonly present: number;
  readonly half: number;
  readonly absent: number;
  readonly daysInMonth: number;
}

/** `month` is YYYY-MM. Days are counted from the marks keyed `memberId|YYYY-MM-DD`; a half day is its own count. */
export function monthCounts(
  marks: ReadonlyMap<string, MirrorAttendance>,
  memberId: string,
  month: string,
): MonthCounts {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const c = { present: 0, half: 0, absent: 0 };
  for (let d = 1; d <= daysInMonth; d++) {
    const status = marks.get(`${memberId}|${month}-${String(d).padStart(2, '0')}`)?.status;
    if (status) c[status] += 1;
  }
  return { ...c, daysInMonth };
}

/** "2026-10" moved by n months, safe across year ends. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
}

/** What paying every approved, unpaid claim records: advances and credits come off, never below zero. */
export function employeeDue(
  entries: readonly CompanyEntry[],
  memberId: string,
): { due: CompanyEntry[]; total: bigint } {
  const due = entries
    .filter((e) => !e.paidByCompany && e.memberId === memberId && isReimbursable(e) && !e.pending)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  const net = buildReimbursementPreview(entries, {
    memberId,
    ids: due.map((e) => e.id),
  }).payoutMinor;
  return { due, total: net < 0n ? 0n : net };
}

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
