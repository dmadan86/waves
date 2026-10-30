/** Data behind the company Overview: who used Waves today, the picked day's attendance and tasks, money and what is due. */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardStats, isGroupRecurringDue, owedByMember } from '@waves/core';

import { useCompanyEntries } from '@/data/companyEntries';
import { usePendingVendorBills } from '@/data/companyVendors';
import { useAttendance, useWorkdayAccess, useWorkTasks } from '@/data/companyWorkday';
import { useGroupRecurring } from '@/data/groupRecurring';
import { todayIso } from '@/data/personal';
import type { MemberRow } from '@/data/types';
import { awaitingApprovals } from '@/lib/companyPending';
import { backend } from '@/lib/backend';
import { sortUpcoming, type UpcomingInput, type UrgentInput } from '@/lib/overviewMath';

export interface ActiveToday {
  readonly total: number;
  readonly active: number;
  readonly activeIds: ReadonlySet<string>;
}

/**
 * Owner/manager only. Counts and member ids from the server (it scopes a manager to their team and
 * skips not-employed people); no device or time ever reaches the phone. null until it loads or offline.
 */
export function useActiveToday(groupId: string): ActiveToday | null {
  const access = useWorkdayAccess(groupId);
  const view = useCompanyEntries(groupId);
  const enabled = access.canManage && access.enabled;
  const q = useQuery({
    // Keyed by viewer: a different account or a demoted owner never reads the previous scope's cache.
    queryKey: ['company-active-today', groupId, view.me?.id, view.isOwner, todayIso()],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await backend.rpc('waves_company_active_today', {
        p_group_id: groupId,
        p_tz_offset_minutes: -new Date().getTimezoneOffset(),
      });
      if (error) throw new Error(error.message);
      const r = data as { total: number; active: number; activeMemberIds: string[] };
      return { total: r.total, active: r.active, activeIds: new Set(r.activeMemberIds) };
    },
  });
  return enabled ? (q.data ?? null) : null;
}

export type DayStatus = 'present' | 'absent' | 'unmarked';

export interface OverviewMoney {
  readonly owes: bigint;
  readonly pendingPayments: number;
  readonly paidMonth: bigint;
  readonly lastPaymentOn: string | null;
  readonly advances: bigint;
  readonly advanceHolders: number;
}

export interface UpcomingRow extends UpcomingInput {
  readonly member: MemberRow | null;
}

export interface Overview {
  readonly ready: boolean;
  readonly suspended: boolean;
  readonly isOwner: boolean;
  readonly currency: string;
  /** Employed people the viewer manages (owner: all, manager: their team) with their mark on the day. */
  readonly people: readonly { member: MemberRow; status: DayStatus }[];
  readonly counts: { present: number; absent: number; unmarked: number };
  readonly tasks: { total: number; done: number; pending: number };
  /** Owner only. */
  readonly money: OverviewMoney | null;
  readonly urgent: UrgentInput;
  readonly upcoming: readonly UpcomingRow[];
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Everything the Overview shows for `day` (a local ISO day, never after today). Not-employed people never count. */
export function useOverview(groupId: string, day: string): Overview {
  const view = useCompanyEntries(groupId);
  const access = useWorkdayAccess(groupId);
  const marks = useAttendance(groupId);
  const allTasks = useWorkTasks(groupId);
  const { rules } = useGroupRecurring(groupId);
  const vendorBills = usePendingVendorBills(groupId).count;
  const isOwner = view.isOwner;
  return useMemo(() => {
    const today = todayIso();
    const shown = day > today ? today : day;
    const people = access.people.map((member) => {
      const s = marks.get(`${member.id}|${shown}`)?.status;
      const status: DayStatus =
        s === 'present' || s === 'half' ? 'present' : s === 'absent' ? 'absent' : 'unmarked';
      return { member, status };
    });
    const counts = { present: 0, absent: 0, unmarked: 0 };
    for (const p of people) counts[p.status] += 1;
    const ids = new Set(people.map((p) => p.member.id));
    let done = 0;
    let blocked = 0;
    let total = 0;
    for (const task of allTasks) {
      if (!ids.has(task.memberId) || task.day !== shown) continue;
      total += 1;
      if (task.status === 'done') done += 1;
      else if (task.status === 'blocked') blocked += 1;
    }
    let money: OverviewMoney | null = null;
    let upcoming: UpcomingRow[] = [];
    if (isOwner) {
      const live = view.members.filter((m) => !m.left_at);
      const stats = dashboardStats(
        view.entries,
        live.map((m) => m.id),
        today,
      );
      let last: string | null = null;
      for (const e of view.entries) {
        const paid =
          e.kind === 'wage_payment' ||
          e.kind === 'wages' ||
          (e.kind === 'reimbursement' && e.direction !== 'employee_to_company');
        if (!e.deleted && paid && e.occurredOn <= today && (!last || e.occurredOn > last))
          last = e.occurredOn;
      }
      money = {
        owes: stats.owes,
        pendingPayments: stats.pendingPayments,
        paidMonth: stats.paidThisMonth,
        lastPaymentOn: last,
        advances: stats.advancesOutstanding,
        advanceHolders: stats.advanceHolders,
      };
      const byId = new Map(view.members.map((m) => [m.id, m]));
      const rows: UpcomingRow[] = [];
      // No due date exists for wages (the company has no pay-day setting), so they are "owed now".
      for (const [id, amountMinor] of owedByMember(view.entries, [...view.manageableIds])) {
        const member = byId.get(id) ?? null;
        if (!member || member.left_at) continue;
        rows.push({
          key: `s-${id}`,
          kind: 'salary',
          memberId: id,
          member,
          title: '',
          amountMinor,
          date: null,
        });
      }
      const end = addDays(today, 7);
      for (const r of rules)
        if (r.status === 'active' && (r.nextDate <= end || isGroupRecurringDue(r, today)))
          rows.push({
            key: `r-${r.id}`,
            kind: 'bill',
            memberId: null,
            member: null,
            title: r.description,
            amountMinor: r.amount,
            date: r.nextDate,
          });
      upcoming = sortUpcoming(rows, 3) as UpcomingRow[];
    }
    const requests = isOwner
      ? view.entries.filter((e) => e.kind === 'pool_request' && !e.deleted).length
      : 0;
    return {
      ready: view.ready,
      suspended: view.suspended,
      isOwner,
      currency: view.currency,
      people,
      counts,
      tasks: { total, done, pending: total - done },
      money,
      urgent: {
        absent: counts.absent,
        paymentsPending: money?.pendingPayments ?? 0,
        blockedTasks: blocked,
        approvals: awaitingApprovals(view).length + requests,
        vendorBills: isOwner ? vendorBills : 0,
      },
      upcoming,
    };
  }, [view, access, marks, allTasks, rules, vendorBills, day, isOwner]);
}
