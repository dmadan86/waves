/** Data behind the company Overview: who used Waves today, today's attendance/tasks, and what is coming up. */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isGroupRecurringDue } from '@waves/core';

import { useUnpaidBills } from '@/data/companyDocuments';
import { useCompanyEntries } from '@/data/companyEntries';
import { useAttendance, useWorkdayAccess, useWorkTasks } from '@/data/companyWorkday';
import { useGroupRecurring } from '@/data/groupRecurring';
import { todayIso } from '@/data/personal';
import { backend } from '@/lib/backend';

const startOfLocalDay = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

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
  const q = useQuery({
    queryKey: ['company-active-today', groupId, todayIso()],
    enabled: access.canManage && access.enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await backend.rpc('waves_company_active_today', {
        p_group_id: groupId,
        p_since: startOfLocalDay(),
      });
      if (error) throw new Error(error.message);
      const r = data as { total: number; active: number; activeMemberIds: string[] };
      return { total: r.total, active: r.active, activeIds: new Set(r.activeMemberIds) };
    },
  });
  return q.data ?? null;
}

export interface TodayCounts {
  readonly attendance: { present: number; absent: number; unmarked: number } | null;
  readonly tasks: { done: number; doing: number; blocked: number; todo: number } | null;
}

/** Today's attendance and tasks for the people the viewer manages (owner: all, manager: team). */
export function useTodayCounts(groupId: string): TodayCounts {
  const access = useWorkdayAccess(groupId);
  const marks = useAttendance(groupId);
  const allTasks = useWorkTasks(groupId);
  return useMemo(() => {
    if (!access.enabled || !access.canManage) return { attendance: null, tasks: null };
    const day = todayIso();
    const ids = new Set(access.people.map((p) => p.id));
    let present = 0;
    let absent = 0;
    for (const p of ids) {
      const s = marks.get(`${p}|${day}`)?.status;
      if (s === 'present' || s === 'half') present += 1;
      else if (s === 'absent') absent += 1;
    }
    const tasks = { done: 0, doing: 0, blocked: 0, todo: 0 };
    for (const task of allTasks)
      if (ids.has(task.memberId) && task.day === day) tasks[task.status] += 1;
    const any = tasks.done + tasks.doing + tasks.blocked + tasks.todo > 0;
    return {
      attendance: { present, absent, unmarked: ids.size - present - absent },
      tasks: any ? tasks : null,
    };
  }, [access, marks, allTasks]);
}

export interface ComingUpRow {
  readonly key: string;
  readonly kind: 'recurring' | 'receivable';
  readonly title: string;
  /** ISO day, or null for "unpaid, no date". */
  readonly date: string | null;
  readonly amountMinor: bigint;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The next 7 days: repeating bills falling due and money customers still owe (unpaid bills have no
 * due date, so they list as "to collect"). Owner only: a manager's own bills are theirs alone.
 * shortcut: no wage day (the company has no pay-day setting) and no calendar on this base.
 */
export function useComingUp(groupId: string): readonly ComingUpRow[] {
  const view = useCompanyEntries(groupId);
  const { rules } = useGroupRecurring(groupId);
  const unpaid = useUnpaidBills(groupId);
  return useMemo(() => {
    if (!view.isOwner) return [];
    const today = todayIso();
    const end = addDays(today, 7);
    const rows: ComingUpRow[] = [];
    for (const r of rules) {
      if (r.status === 'active' && (r.nextDate <= end || isGroupRecurringDue(r, today)))
        rows.push({
          key: `r-${r.id}`,
          kind: 'recurring',
          title: r.description,
          date: r.nextDate,
          amountMinor: r.amount,
        });
    }
    rows.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    for (const d of unpaid.bills.slice(0, 3)) {
      rows.push({
        key: `b-${d.id}`,
        kind: 'receivable',
        title: d.customerName,
        date: null,
        amountMinor: d.totalMinor - d.paidMinor,
      });
    }
    return rows.slice(0, 5);
  }, [view.isOwner, rules, unpaid.bills]);
}
