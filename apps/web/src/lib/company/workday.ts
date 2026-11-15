'use client';

/** Attendance and daily work (web). Who sees what is the server's job (RLS). */
import { useMemo } from 'react';
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

import { NO_QUEUE, useSync } from '@/lib/sync';
import { todayIso, useCompanyView, type CompanyMember as MemberRow } from './view';

export type { AttendanceStatus, MirrorAttendance, MirrorWorkTask, WorkdayCounts };

export { todayIso };

/** Marks keyed `${memberId}|${day}`. */
export function useAttendance(groupId: string): ReadonlyMap<string, MirrorAttendance> {
  const { mirror } = useSync();
  return useMemo(() => materialiseAttendance(mirror, NO_QUEUE, { groupId }), [mirror, groupId]);
}

export function useWorkTasks(groupId: string): readonly MirrorWorkTask[] {
  const { mirror } = useSync();
  return useMemo(() => materialiseWorkTasks(mirror, NO_QUEUE, { groupId }), [mirror, groupId]);
}

export interface WorkdayAccess {
  readonly enabled: boolean;
  readonly canManage: boolean;
  /** Whom the viewer may mark / assign work to. Empty for an employee. */
  readonly people: readonly MemberRow[];
  readonly me: MemberRow | null;
  readonly isEmployee: boolean;
  /** Whom a task may be assigned to: the owner employees and managers, a manager their team and themself, an employee themself. */
  readonly assignees: readonly MemberRow[];
  readonly meId: string | null;
}

export function useWorkdayAccess(groupId: string): WorkdayAccess {
  const view = useCompanyView(groupId);
  return useMemo(() => {
    const live = view.members.filter((m) => !m.left_at && m.role === 'member');
    const canManage = view.isAdmin;
    const isEmployee = !canManage && view.me?.role === 'member';
    const assignees = view.isOwner
      ? view.members.filter(
          (m) =>
            !m.left_at &&
            (m.role === 'member' || m.role === 'manager') &&
            view.manageableIds.has(m.id),
        )
      : view.isManager && view.me
        ? [...live.filter((m) => view.manageableIds.has(m.id)), view.me]
        : isEmployee && view.me
          ? [view.me]
          : [];
    return {
      assignees,
      meId: view.me?.id ?? null,
      enabled: live.length > 0,
      canManage,
      people: canManage ? live.filter((m) => view.manageableIds.has(m.id)) : [],
      me: isEmployee ? view.me : null,
      isEmployee,
    };
  }, [view.members, view.isAdmin, view.isOwner, view.isManager, view.manageableIds, view.me]);
}

/** The write side, payloads exactly as the mobile hooks send them. */
export function useWorkdayActions(groupId: string) {
  const { mutate } = useSync();
  return {
    /** Set (null status clears) one person's mark for one day. */
    setAttendance: (input: CompanyAttendanceSetPayload) =>
      mutate(MutationKind.CompanyAttendanceSet, groupId, { ...input }),
    setTask: (input: CompanyWorkSetPayload) =>
      mutate(MutationKind.CompanyWorkSet, groupId, { ...input }),
    removeTask: (input: { taskId: string }) =>
      mutate(MutationKind.CompanyWorkRemove, groupId, { ...input }),
  };
}

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
