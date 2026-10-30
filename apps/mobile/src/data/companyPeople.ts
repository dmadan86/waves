/** Pure helpers behind the People screen: employment type, today's attendance/tasks and balances, built once per render. */

import { dashboardStats, type CompanyEntry } from '@waves/core';

import type { MirrorAttendance, MirrorWorkTask } from '@/data/companyWorkday';
import type { MemberRow } from '@/data/types';

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contractor'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export function asEmploymentType(value: string | null | undefined): EmploymentType | null {
  return EMPLOYMENT_TYPES.find((type) => type === value) ?? null;
}

/** Same rule as the server RPC: an owner sets anyone, a manager only their own team's employees. */
export function canSetEmploymentType(
  viewer: Pick<MemberRow, 'id' | 'role' | 'left_at'> | null,
  member: Pick<MemberRow, 'role' | 'manager_id' | 'left_at'>,
  suspended: boolean,
): boolean {
  if (suspended || !viewer || viewer.left_at || member.left_at) return false;
  return (
    viewer.role === 'admin' ||
    (viewer.role === 'manager' && member.role === 'member' && member.manager_id === viewer.id)
  );
}

export type BalanceKind = 'settled' | 'companyOwes' | 'owesCompany';
export interface Balance {
  readonly kind: BalanceKind;
  readonly amount: bigint;
}

/** Each person's balance, one pass: entries grouped by member first so no row rescans them all. */
export function balancesByMember(
  entries: readonly CompanyEntry[],
  memberIds: readonly string[],
  today: string,
): ReadonlyMap<string, Balance> {
  const byMember = new Map<string, CompanyEntry[]>();
  for (const e of entries) {
    const list = byMember.get(e.memberId);
    if (list) list.push(e);
    else byMember.set(e.memberId, [e]);
  }
  const out = new Map<string, Balance>();
  for (const id of memberIds) {
    const net = dashboardStats(byMember.get(id) ?? [], [id], today);
    out.set(
      id,
      net.owes > 0n
        ? { kind: 'companyOwes', amount: net.owes }
        : net.advancesOutstanding > 0n
          ? { kind: 'owesCompany', amount: net.advancesOutstanding }
          : { kind: 'settled', amount: 0n },
    );
  }
  return out;
}

/** Tasks still to do today per person (anything not done). */
export function openTasksToday(
  tasks: readonly MirrorWorkTask[],
  day: string,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const task of tasks)
    if (task.day === day && task.status !== 'done')
      out.set(task.memberId, (out.get(task.memberId) ?? 0) + 1);
  return out;
}

export function attendanceToday(
  marks: ReadonlyMap<string, MirrorAttendance>,
  memberId: string,
  day: string,
): MirrorAttendance['status'] | null {
  return marks.get(`${memberId}|${day}`)?.status ?? null;
}

/** This month's allocation per manager (cash given to spend), one pass over the entries. */
export function monthlyBudgets(
  entries: readonly CompanyEntry[],
  month: string,
): ReadonlyMap<string, bigint> {
  const out = new Map<string, bigint>();
  for (const e of entries)
    if (e.kind === 'allocation' && !e.deleted && e.occurredOn.slice(0, 7) === month)
      out.set(e.memberId, (out.get(e.memberId) ?? 0n) + e.amount);
  return out;
}
