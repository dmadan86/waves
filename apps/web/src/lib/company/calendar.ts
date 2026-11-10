'use client';

/** Company calendar: holidays, leave, events, birthdays (web). Who sees what is the server's job. */
import { useMemo } from 'react';
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

import { NO_QUEUE, useSync } from '@/lib/sync';
import { useCompanyView } from './view';

export type {
  MirrorCalendar,
  MirrorHoliday,
  MirrorLeave,
  MirrorEvent,
  MirrorMemberDates,
} from '@waves/core';
export { workedDaysText };

export function useCalendar(groupId: string): MirrorCalendar {
  const { mirror } = useSync();
  const meId = useCompanyView(groupId).me?.id ?? null;
  return useMemo(
    () => materialiseCalendar(mirror, NO_QUEUE, { groupId, meId }),
    [mirror, groupId, meId],
  );
}

type GroupSwitches = { company_paid_holidays?: boolean; company_paid_leave?: boolean };

/** The two per-company wage switches (owner sets them). */
export function useCalendarSettings(groupId: string): {
  paidHolidays: boolean;
  paidLeave: boolean;
} {
  const { group } = useCompanyView(groupId);
  return {
    paidHolidays: (group as GroupSwitches | null)?.company_paid_holidays !== false,
    paidLeave: (group as GroupSwitches | null)?.company_paid_leave === true,
  };
}

/** Holidays + approved leave + the switches, in the shape the wage-days prefill wants. */
export function usePayRule(groupId: string): CalendarPayRule {
  const cal = useCalendar(groupId);
  const { paidHolidays, paidLeave } = useCalendarSettings(groupId);
  return useMemo(() => {
    // A leave type's own "paid" setting wins over the company-wide switch for requests that name it.
    const paidOf = new Map(cal.leaveTypes.map((x) => [x.id, x.paid]));
    const leave = cal.leave.map((l) =>
      l.leaveTypeId && paidOf.has(l.leaveTypeId) ? { ...l, paid: paidOf.get(l.leaveTypeId) } : l,
    );
    return { holidays: cal.holidays, leave, paidHolidays, paidLeave };
  }, [cal, paidHolidays, paidLeave]);
}

export interface CalendarAccess {
  readonly isOwner: boolean;
  readonly canManage: boolean;
  readonly meId: string | null;
  /** Leave the viewer may approve: not their own, and (manager) from their team. */
  readonly canDecide: (leave: { memberId: string }) => boolean;
}

export function useCalendarAccess(groupId: string): CalendarAccess {
  const view = useCompanyView(groupId);
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

export function useCalendarActions(groupId: string) {
  const { mutate } = useSync();
  const send = (kind: MutationKind, input: object) =>
    mutate(kind, groupId, { ...input } as Record<string, unknown>);
  return {
    setHoliday: (i: CompanyHolidaySetPayload) => send(MutationKind.CompanyHolidaySet, i),
    removeHoliday: (i: { id: string }) => send(MutationKind.CompanyHolidayRemove, i),
    setLeave: (i: CompanyLeaveSetPayload) => send(MutationKind.CompanyLeaveSet, i),
    decideLeave: (i: CompanyLeaveDecidePayload) => send(MutationKind.CompanyLeaveDecide, i),
    removeLeave: (i: { id: string }) => send(MutationKind.CompanyLeaveRemove, i),
    setEvent: (i: CompanyEventSetPayload) => send(MutationKind.CompanyEventSet, i),
    removeEvent: (i: { id: string }) => send(MutationKind.CompanyEventRemove, i),
    setDates: (i: CompanyDatesSetPayload) => send(MutationKind.CompanyDatesSet, i),
    setSettings: (i: { paidHolidays: boolean; paidLeave: boolean }) =>
      send(MutationKind.CompanyCalendarSettingsSet, i),
  };
}
