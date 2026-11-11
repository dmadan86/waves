'use client';

/** Leave policies and balances (web). Balances come from the shared pure `leaveBalance` in @waves/core. */
import { useMemo } from 'react';
import {
  leaveBalance,
  leaveCheck,
  leaveDays,
  MutationKind,
  type CompanyLeaveTypeSetPayload,
  type LeaveBalance,
  type LeaveBalanceRule,
  type LeaveCheck,
  type MirrorLeaveType,
} from '@waves/core';

import { useSync } from '@/lib/sync';
import { useCalendar } from './calendar';
import { todayIso, useCompanyView } from './view';

export type { MirrorLeaveType } from '@waves/core';

export const ruleOf = (t: MirrorLeaveType): LeaveBalanceRule => ({
  accrualPerMonth: t.accrualPerMonth,
  carryForward: t.carryForward,
  carryForwardCap: t.carryForwardCap,
  annualCap: t.annualCap,
  startDay: t.startsOn,
});

export { daysText, parseLimit, validAccrual } from './leaveFields';

export interface TypeBalance {
  readonly type: MirrorLeaveType;
  readonly balance: LeaveBalance;
  /** Days asked for and still waiting for a decision. */
  readonly requested: number;
}

export function useLeaveTypes(groupId: string, activeOnly = false): readonly MirrorLeaveType[] {
  const cal = useCalendar(groupId);
  return useMemo(
    () => (activeOnly ? cal.leaveTypes.filter((t) => t.active) : cal.leaveTypes),
    [cal.leaveTypes, activeOnly],
  );
}

/** A person's joining date: the one entered, else the day they were added. */
export function useJoinedOn(groupId: string): (memberId: string) => string {
  const cal = useCalendar(groupId);
  const { members } = useCompanyView(groupId);
  return (memberId) =>
    cal.dates.get(memberId)?.joinedOn ??
    (String(members.find((m) => m.id === memberId)?.created_at ?? '').slice(0, 10) ||
      '1970-01-01');
}

export function useLeaveBalances(groupId: string, memberId: string | null): TypeBalance[] {
  const cal = useCalendar(groupId);
  const join = useJoinedOn(groupId)(memberId ?? '');
  const today = todayIso();
  return useMemo(() => {
    if (!memberId) return [];
    return cal.leaveTypes
      .filter((t) => t.active)
      .map((type) => {
        const mine = cal.leave.filter((l) => l.memberId === memberId && l.leaveTypeId === type.id);
        return {
          type,
          balance: leaveBalance({ rule: ruleOf(type), joinedOn: join, asOf: today, uses: mine }),
          requested: mine
            .filter((l) => l.status === 'pending')
            .reduce((sum, l) => sum + leaveDays(l), 0),
        };
      });
  }, [cal.leaveTypes, cal.leave, memberId, join, today]);
}

/** The pre-submit check for one request (same rule as the server at approval). */
export function useLeaveCheck(
  groupId: string,
  req: {
    memberId: string;
    typeId: string | null;
    startDay: string;
    endDay: string;
    halfDay: boolean;
  },
): (LeaveCheck & { type: MirrorLeaveType }) | null {
  const cal = useCalendar(groupId);
  const joinedOn = useJoinedOn(groupId);
  const type = cal.leaveTypes.find((t) => t.id === req.typeId);
  if (!type || !req.memberId || req.endDay < req.startDay) return null;
  const uses = cal.leave.filter((l) => l.memberId === req.memberId && l.leaveTypeId === type.id);
  const check = leaveCheck({
    rule: ruleOf(type),
    allowOverdraw: type.allowOverdraw,
    joinedOn: joinedOn(req.memberId),
    uses,
    request: req,
  });
  return { ...check, type };
}

export function useLeaveTypeActions(groupId: string) {
  const { mutate } = useSync();
  return {
    set: (i: CompanyLeaveTypeSetPayload) =>
      mutate(MutationKind.CompanyLeaveTypeSet, groupId, { ...i } as Record<string, unknown>),
    remove: (i: { id: string }) =>
      mutate(MutationKind.CompanyLeaveTypeRemove, groupId, { ...i } as Record<string, unknown>),
  };
}
