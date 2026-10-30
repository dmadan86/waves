/**
 * Company calendar: holidays, leave, events, birthdays; read local-first, written through the offline queue.
 * Who sees what is the server's job (RLS); the helpers here only decide what the viewer may do.
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  materialiseCalendar,
  MutationKind,
  workedDaysText,
  type CalendarPayRule,
  type CompanyDatesSetPayload,
  type CompanyEventSetPayload,
  type CompanyHolidaySetPayload,
  type CompanyLeaveDecidePayload,
  type CompanyLeaveSetPayload,
  type MirrorCalendar,
} from '@waves/core';

import { useCompanyEntries } from '@/data/companyEntries';
import { useGroup } from '@/data/hooks';
import { useSync } from '@/sync';

export type {
  MirrorCalendar,
  MirrorHoliday,
  MirrorLeave,
  MirrorEvent,
  MirrorMemberDates,
} from '@waves/core';

export function useCalendar(groupId: string): MirrorCalendar {
  const { mirror, queue } = useSync();
  const meId = useCompanyEntries(groupId).me?.id ?? null;
  return useMemo(
    () => materialiseCalendar(mirror, queue, { groupId, meId }),
    [mirror, queue, groupId, meId],
  );
}

/** The two per-company wage switches (owner sets them). */
export function useCalendarSettings(groupId: string): {
  paidHolidays: boolean;
  paidLeave: boolean;
} {
  const { group } = useGroup(groupId);
  const { queue } = useSync();
  // This phone's own queued change wins until the server confirms it.
  const queued = [...queue]
    .filter(
      (m) => m.groupId === groupId && !m.rejection && m.kind === 'company_calendar.settings_set',
    )
    .sort((x, y) => y.seq - x.seq)[0]?.payload as
    { paidHolidays: boolean; paidLeave: boolean } | undefined;
  return {
    paidHolidays: queued ? queued.paidHolidays : group.data?.company_paid_holidays !== false,
    paidLeave: queued ? queued.paidLeave : group.data?.company_paid_leave === true,
  };
}

/** Holidays + approved leave + the switches, in the shape the wage-days prefill wants. */
export function usePayRule(groupId: string): CalendarPayRule {
  const cal = useCalendar(groupId);
  const s = useCalendarSettings(groupId);
  const { paidHolidays, paidLeave } = s;
  return useMemo(
    () => ({ holidays: cal.holidays, leave: cal.leave, paidHolidays, paidLeave }),
    [cal, paidHolidays, paidLeave],
  );
}
export { workedDaysText };

export interface CalendarAccess {
  readonly isOwner: boolean;
  /** Owner or manager: may record leave for their people, add events. */
  readonly canManage: boolean;
  /** The viewer's own member id, or null. */
  readonly meId: string | null;
  /** Leave the viewer may approve: pending, not their own, and (manager) from their team. */
  readonly canDecide: (leave: { memberId: string }) => boolean;
}

export function useCalendarAccess(groupId: string): CalendarAccess {
  const view = useCompanyEntries(groupId);
  return useMemo(
    () => ({
      isOwner: view.isOwner,
      canManage: view.isAdmin,
      meId: view.me?.id ?? null,
      canDecide: (leave) =>
        view.isAdmin &&
        leave.memberId !== view.me?.id &&
        (view.isOwner || view.manageableIds.has(leave.memberId)),
    }),
    [view.isOwner, view.isAdmin, view.me, view.manageableIds],
  );
}

/** Leave waiting for the viewer's decision (Pending screen and its badge). */
export function usePendingLeave(groupId: string) {
  const cal = useCalendar(groupId);
  const access = useCalendarAccess(groupId);
  return useMemo(
    () => cal.leave.filter((l) => l.status === 'pending' && access.canDecide(l)),
    [cal.leave, access],
  );
}

function useCalendarMutation<T extends object>(groupId: string, kind: MutationKind) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: T) => mutate(kind, groupId, { ...input } as Record<string, unknown>),
  });
}
export const useSetHoliday = (g: string) =>
  useCalendarMutation<CompanyHolidaySetPayload>(g, MutationKind.CompanyHolidaySet);
export const useRemoveHoliday = (g: string) =>
  useCalendarMutation<{ id: string }>(g, MutationKind.CompanyHolidayRemove);
export const useSetLeave = (g: string) =>
  useCalendarMutation<CompanyLeaveSetPayload>(g, MutationKind.CompanyLeaveSet);
export const useDecideLeave = (g: string) =>
  useCalendarMutation<CompanyLeaveDecidePayload>(g, MutationKind.CompanyLeaveDecide);
export const useRemoveLeave = (g: string) =>
  useCalendarMutation<{ id: string }>(g, MutationKind.CompanyLeaveRemove);
export const useSetEvent = (g: string) =>
  useCalendarMutation<CompanyEventSetPayload>(g, MutationKind.CompanyEventSet);
export const useRemoveEvent = (g: string) =>
  useCalendarMutation<{ id: string }>(g, MutationKind.CompanyEventRemove);
export const useSetDates = (g: string) =>
  useCalendarMutation<CompanyDatesSetPayload>(g, MutationKind.CompanyDatesSet);
export const useSetCalendarSettings = (g: string) =>
  useCalendarMutation<{ paidHolidays: boolean; paidLeave: boolean }>(
    g,
    MutationKind.CompanyCalendarSettingsSet,
  );
