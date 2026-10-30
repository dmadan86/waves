/** Data behind the company Overview: who used Waves today, the picked day's attendance and tasks, money and what is due. */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardStats, type CompanyEntry, type MirrorWorkTask } from '@waves/core';

import { useCompanyEntries, useCompanyProjects } from '@/data/companyEntries';
import { usePendingVendorBills } from '@/data/companyVendors';
import { useAttendance, useWorkdayAccess, useWorkTasks } from '@/data/companyWorkday';
import { useCalendar } from '@/data/companyCalendar';
import { todayIso } from '@/data/personal';
import { displayName, type MemberRow } from '@/data/types';
import { awaitingApprovals } from '@/lib/companyPending';
import { backend } from '@/lib/backend';
import {
  ABSENT_STREAK_DAYS,
  absentStreak,
  buildEscalations,
  nowMs,
  vsLastMonth,
  type DayMark,
  type EscalationInput,
} from '@/lib/overviewMath';

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

export type DayStatus = 'present' | 'leave' | 'absent' | 'unmarked';

export interface OverviewMoney {
  readonly owes: bigint;
  readonly pendingPayments: number;
  readonly paidMonth: bigint;
  /** Against last month; null when last month paid nothing (the line is hidden). */
  readonly paidChange: { dir: 'up' | 'down'; pct: number } | null;
  readonly advances: bigint;
  readonly advanceHolders: number;
}

export interface OverviewTask {
  readonly task: MirrorWorkTask;
  readonly site: string | null;
}

export interface EscalationRow extends EscalationInput {
  readonly member: MemberRow | null;
}

export interface Overview {
  readonly ready: boolean;
  readonly suspended: boolean;
  readonly isOwner: boolean;
  readonly currency: string;
  /** Employed people the viewer manages (owner: all, manager: their team) with their mark on the day. */
  readonly people: readonly { member: MemberRow; status: DayStatus }[];
  readonly counts: { present: number; leave: number; absent: number; unmarked: number };
  /** True once the company has approved leave: it then gets its own legend entry and "not marked" turns grey. */
  readonly hasLeave: boolean;
  /** Owner only. */
  readonly money: OverviewMoney | null;
  /** Today's tasks of the people the viewer manages: up to three still open, and the day's totals. */
  readonly tasks: { open: readonly OverviewTask[]; total: number; openCount: number };
  readonly escalations: { items: readonly EscalationRow[]; total: number };
  /** ms the numbers were computed at, for "time ago". */
  readonly now: number;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00`);

/** Everything the Overview shows; attendance is for `day` (a local ISO day, never after today), the rest is today. */
export function useOverview(groupId: string, day: string): Overview {
  const view = useCompanyEntries(groupId);
  const access = useWorkdayAccess(groupId);
  const marks = useAttendance(groupId);
  const allTasks = useWorkTasks(groupId);
  const cal = useCalendar(groupId);
  const projects = useCompanyProjects(groupId);
  const vendorBills = usePendingVendorBills(groupId);
  const isOwner = view.isOwner;
  return useMemo(() => {
    const today = todayIso();
    const shown = day > today ? today : day;
    const approvedLeave = cal.leave.filter((l) => l.status === 'approved');
    const onLeave = (memberId: string, d: string) =>
      approvedLeave.some((l) => l.memberId === memberId && l.startDay <= d && d <= l.endDay);
    const people = access.people.map((member) => {
      const s = marks.get(`${member.id}|${shown}`)?.status;
      const status: DayStatus =
        s === 'present' || s === 'half'
          ? 'present'
          : s === 'absent'
            ? 'absent'
            : onLeave(member.id, shown)
              ? 'leave'
              : 'unmarked';
      return { member, status };
    });
    const counts = { present: 0, leave: 0, absent: 0, unmarked: 0 };
    for (const p of people) counts[p.status] += 1;
    const ids = new Set(people.map((p) => p.member.id));

    const siteName = new Map(projects.map((p) => [p.id, p.name]));
    const todays = allTasks.filter((task) => ids.has(task.memberId) && task.day === today);
    const open = todays
      .filter((task) => task.status !== 'done')
      .sort(
        (a, b) =>
          (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
          a.title.localeCompare(b.title),
      );

    let money: OverviewMoney | null = null;
    if (isOwner) {
      const live = view.members.filter((m) => !m.left_at);
      const stats = dashboardStats(
        view.entries,
        live.map((m) => m.id),
        today,
      );
      money = {
        owes: stats.owes,
        pendingPayments: stats.pendingPayments,
        paidMonth: stats.paidThisMonth,
        paidChange: vsLastMonth(stats.paidThisMonth, stats.paidLastMonth),
        advances: stats.advancesOutstanding,
        advanceHolders: stats.advanceHolders,
      };
    }

    const byId = new Map(view.members.map((m) => [m.id, m]));
    const nameOf = (id: string) => (byId.get(id) ? displayName(byId.get(id) as MemberRow) : '');
    const at = (e: CompanyEntry) => {
      const ms = Date.parse(e.createdAt);
      return Number.isNaN(ms) ? dayMs(e.occurredOn) : ms;
    };
    const rows: EscalationInput[] = [];
    for (const e of awaitingApprovals(view))
      rows.push({
        key: `e-${e.id}`,
        kind: e.kind === 'advance' ? 'advance' : 'expense',
        name: nameOf(e.memberId),
        memberId: e.memberId || null,
        amountMinor: e.amount,
        at: at(e),
      });
    if (isOwner)
      for (const e of view.entries)
        if (e.kind === 'pool_request' && !e.deleted)
          rows.push({
            key: `p-${e.id}`,
            kind: 'poolRequest',
            name: nameOf(e.memberId),
            memberId: e.memberId || null,
            amountMinor: e.amount,
            at: at(e),
          });
    // Vendor bills are an owner's to confirm; a manager only ever sees the ones they added.
    for (const bill of vendorBills.bills)
      rows.push({
        key: `v-${bill.id}`,
        kind: 'vendorBill',
        name: vendorBills.vendorName(bill.vendorId),
        memberId: null,
        amountMinor: bill.amount,
        at: Date.parse(bill.createdAt) || dayMs(bill.occurredOn),
      });
    for (const task of allTasks)
      if (ids.has(task.memberId) && task.status === 'blocked' && task.day <= today)
        rows.push({
          key: `t-${task.id}`,
          kind: 'blocked',
          name: nameOf(task.memberId),
          memberId: task.memberId,
          amountMinor: null,
          at: dayMs(task.day),
          detail: task.title,
        });
    // Absent or unmarked 3+ days running, looking back two weeks. A day nobody was marked (or a holiday) is "off".
    const lookback = Array.from({ length: 14 }, (_, i) => addDays(today, -i));
    const taken = new Set<string>();
    for (const m of marks.values()) if (ids.has(m.memberId)) taken.add(m.day);
    const holiday = (d: string) => cal.holidays.some((h) => h.startDay <= d && d <= h.endDay);
    for (const { member } of people) {
      const days: DayMark[] = lookback.map((d) => {
        const s = marks.get(`${member.id}|${d}`)?.status;
        return s === 'present' || s === 'half'
          ? 'present'
          : s === 'absent'
            ? 'absent'
            : onLeave(member.id, d)
              ? 'leave'
              : holiday(d) || !taken.has(d)
                ? 'off'
                : 'unmarked';
      });
      const n = absentStreak(days);
      if (n >= ABSENT_STREAK_DAYS)
        rows.push({
          key: `a-${member.id}`,
          kind: 'absent',
          name: displayName(member),
          memberId: member.id,
          amountMinor: null,
          days: n,
          at: dayMs(addDays(today, -(n - 1))),
        });
    }
    const built = buildEscalations(rows, 3);
    return {
      now: nowMs(),
      ready: view.ready,
      suspended: view.suspended,
      isOwner,
      currency: view.currency,
      people,
      counts,
      hasLeave: approvedLeave.length > 0,
      money,
      tasks: {
        open: open.slice(0, 3).map((task) => ({
          task,
          site: task.projectId ? (siteName.get(task.projectId) ?? null) : null,
        })),
        total: todays.length,
        openCount: open.length,
      },
      escalations: {
        items: built.items.map((r) => ({
          ...r,
          member: r.memberId ? (byId.get(r.memberId) ?? null) : null,
        })),
        total: built.total,
      },
    };
  }, [view, access, marks, allTasks, cal, projects, vendorBills, day, isOwner]);
}
