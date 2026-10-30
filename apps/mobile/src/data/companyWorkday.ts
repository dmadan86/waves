/**
 * Company attendance and daily work, read local-first and written through the offline queue.
 * Who sees what is the server's job (RLS: owner all, manager their team, employee own rows);
 * the helpers here only decide what the viewer may do and show.
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  materialiseAttendance,
  materialiseWorkTasks,
  MutationKind,
  workdayCounts,
  type AttendanceStatus,
  type CompanyAttendanceSetPayload,
  type CompanyWorkSetPayload,
  type MirrorAttendance,
  type MirrorWorkTask,
  type WorkdayCounts,
} from '@waves/core';

import { useCompanyEntries } from '@/data/companyEntries';
import type { MemberRow } from '@/data/types';
import { todayIso } from '@/data/personal';
import { useSync } from '@/sync';

export type { AttendanceStatus, MirrorAttendance, MirrorWorkTask, WorkdayCounts };

/** Marks keyed `${memberId}|${day}`. */
export function useAttendance(groupId: string): ReadonlyMap<string, MirrorAttendance> {
  const { mirror, queue } = useSync();
  return useMemo(() => materialiseAttendance(mirror, queue, { groupId }), [mirror, queue, groupId]);
}

export function useWorkTasks(groupId: string): readonly MirrorWorkTask[] {
  const { mirror, queue } = useSync();
  return useMemo(() => materialiseWorkTasks(mirror, queue, { groupId }), [mirror, queue, groupId]);
}

export interface WorkdayAccess {
  /** Attendance and work show up once the company has at least one employee. */
  readonly enabled: boolean;
  /** Owner or manager: may mark attendance and add tasks. */
  readonly canManage: boolean;
  /** Whom the viewer may mark / assign work to (owner: all, manager: own team). Empty for an employee. */
  readonly people: readonly MemberRow[];
  /** The viewer as an employee (null for owners/managers who are not employees). */
  readonly me: MemberRow | null;
  readonly isEmployee: boolean;
}

export function useWorkdayAccess(groupId: string): WorkdayAccess {
  const view = useCompanyEntries(groupId);
  return useMemo(() => {
    const live = view.members.filter((m) => !m.left_at && m.role === 'member');
    const canManage = view.isAdmin;
    const people = canManage ? live.filter((m) => view.manageableIds.has(m.id)) : [];
    const isEmployee = !canManage && view.me?.role === 'member';
    return {
      enabled: live.length > 0,
      canManage,
      people,
      me: isEmployee ? view.me : null,
      isEmployee,
    };
  }, [view.members, view.isAdmin, view.manageableIds, view.me]);
}

/** Owner/manager: set (null clears) one person's mark for one day. */
export function useSetAttendance(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: CompanyAttendanceSetPayload) =>
      mutate(MutationKind.CompanyAttendanceSet, groupId, { ...input }),
  });
}

/** Add or edit a task; an employee only changes status, blocked reason and note on their own. */
export function useSetWorkTask(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: CompanyWorkSetPayload) =>
      mutate(MutationKind.CompanyWorkSet, groupId, { ...input }),
  });
}

export function useRemoveWorkTask(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { taskId: string }) =>
      mutate(MutationKind.CompanyWorkRemove, groupId, { ...input }),
  });
}

/** For the Pending screen: Blocked tasks and people not yet marked today (owner/manager only; zeros otherwise). */
export function useWorkdayCounts(groupId: string): WorkdayCounts {
  const access = useWorkdayAccess(groupId);
  const marks = useAttendance(groupId);
  const tasks = useWorkTasks(groupId);
  return useMemo(
    () =>
      access.enabled && access.canManage
        ? workdayCounts(
            access.people.map((p) => p.id),
            marks.values(),
            tasks.filter((t) => access.people.some((p) => p.id === t.memberId)),
            todayIso(),
          )
        : { blocked: 0, unmarked: 0 },
    [access, marks, tasks],
  );
}
