/** Pure helpers behind the People screen: employment type, today's attendance/tasks and balances, built once per render. */

import {
  dashboardStats,
  formatParts,
  money,
  minorUnitScale,
  poolBalance,
  type CompanyEntry,
} from '@waves/core';

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

/**
 * A manager's balance is their cash pool, not an employee ledger (allocations, returns and spend
 * all count): float still held reads "owes company", a pool overspent reads "company owes".
 */
export function managerBalances(
  entries: readonly CompanyEntry[],
  managerIds: readonly string[],
): ReadonlyMap<string, Balance> {
  const out = new Map<string, Balance>();
  for (const id of managerIds) {
    const bal = poolBalance(entries, id).balance;
    out.set(
      id,
      bal > 0n
        ? { kind: 'owesCompany', amount: bal }
        : bal < 0n
          ? { kind: 'companyOwes', amount: -bal }
          : { kind: 'settled', amount: 0n },
    );
  }
  return out;
}

/** Whole rupees ("₹1,250") when there are no paise; the full amount otherwise. */
export function wholeMoney(minor: bigint, currency: string, locale: string): string {
  const parts = formatParts(money(minor, currency), { locale });
  return minor % minorUnitScale(currency) === 0n ? parts.lead + parts.trail : parts.text;
}

/** Red = owes the company; green = settled or the company owes them. */
export function balanceTone(b: Balance): 'negative' | 'positive' {
  return b.kind === 'owesCompany' ? 'negative' : 'positive';
}

export type PersonRole = 'employee' | 'manager' | 'owner';
export type PeopleSort = 'name' | 'attendance' | 'balance' | 'tasks';
export type PeopleMark = 'present' | 'half' | 'absent' | 'unmarked';

export interface PeopleRow {
  readonly id: string;
  readonly name: string;
  readonly role: PersonRole;
  readonly former: boolean;
  readonly departmentId: string | null;
  readonly mark: MirrorAttendance['status'] | null;
  readonly tasks: number;
  /** Null for owners: they carry no ledger. */
  readonly balance: Balance | null;
}

export interface PeopleFilter {
  readonly roles: readonly PersonRole[];
  readonly status: 'employed' | 'notEmployed';
  readonly departmentId: string | null;
  readonly mark: PeopleMark | null;
}

/** Employed people, employees and managers; owners only when the filter picks them. */
export const DEFAULT_PEOPLE_FILTER: PeopleFilter = {
  roles: ['employee', 'manager'],
  status: 'employed',
  departmentId: null,
  mark: null,
};

const MARK_RANK = { present: 0, half: 1, absent: 2 } as const;

/** Filter, search and sort in one pass; ties always fall back to the name. */
export function listPeople(
  rows: readonly PeopleRow[],
  filter: PeopleFilter,
  sort: PeopleSort,
  query: string,
): PeopleRow[] {
  const q = query.trim().toLowerCase();
  const byName = (a: PeopleRow, b: PeopleRow) => a.name.localeCompare(b.name);
  const rank = (r: PeopleRow) => (r.mark ? MARK_RANK[r.mark] : 3);
  const amount = (r: PeopleRow) => r.balance?.amount ?? 0n;
  const order: Record<PeopleSort, (a: PeopleRow, b: PeopleRow) => number> = {
    name: byName,
    attendance: (a, b) => rank(a) - rank(b),
    balance: (a, b) => (amount(a) === amount(b) ? 0 : amount(a) > amount(b) ? -1 : 1),
    tasks: (a, b) => b.tasks - a.tasks,
  };
  return rows
    .filter(
      (r) =>
        r.former === (filter.status === 'notEmployed') &&
        filter.roles.includes(r.role) &&
        (!filter.departmentId || r.departmentId === filter.departmentId) &&
        (!filter.mark || (r.mark ?? 'unmarked') === filter.mark) &&
        (!q || r.name.toLowerCase().includes(q)),
    )
    .sort((a, b) => order[sort](a, b) || byName(a, b));
}
