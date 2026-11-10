/**
 * Leave policies and balances: the owner's leave types, and what each person has left of each.
 * Balances are derived on the phone by the same pure function the server checks approvals with
 * (`leaveBalance` in @waves/core), from the leave rows this viewer is allowed to read.
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  leaveBalance,
  leaveCheck,
  leaveDays,
  MutationKind,
  type CompanyLeaveTypeSetPayload,
  type LeaveBalance,
  type LeaveBalanceRule,
  type LeaveCheck,
  type MirrorLeave,
  type MirrorLeaveType,
} from '@waves/core';

import { useCalendar } from '@/data/companyCalendar';
import { useCompanyEntries } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { useSync } from '@/sync';

export type { MirrorLeaveType } from '@waves/core';

export const ruleOf = (t: MirrorLeaveType): LeaveBalanceRule => ({
  accrualPerMonth: t.accrualPerMonth,
  carryForward: t.carryForward,
  carryForwardCap: t.carryForwardCap,
  annualCap: t.annualCap,
  startDay: t.startsOn,
});

export interface TypeBalance {
  readonly type: MirrorLeaveType;
  readonly balance: LeaveBalance;
  /** Days asked for and still waiting for a decision. */
  readonly requested: number;
}

/** The viewer's own types, newest rules; `activeOnly` hides the ones the owner parked. */
export function useLeaveTypes(groupId: string, activeOnly = false): readonly MirrorLeaveType[] {
  const cal = useCalendar(groupId);
  return useMemo(
    () => (activeOnly ? cal.leaveTypes.filter((t) => t.active) : cal.leaveTypes),
    [cal.leaveTypes, activeOnly],
  );
}

/** A person's joining date: the one they or the owner entered, else the day they were added. */
export function useJoinedOn(groupId: string): (memberId: string) => string {
  const cal = useCalendar(groupId);
  const { members } = useCompanyEntries(groupId);
  return (memberId) =>
    cal.dates.get(memberId)?.joinedOn ??
    members.find((m) => m.id === memberId)?.created_at?.slice(0, 10) ??
    '1970-01-01';
}

/** Per-type balance of one person as of today. Empty while that person's leave is not readable. */
export function useLeaveBalances(groupId: string, memberId: string | null): TypeBalance[] {
  const cal = useCalendar(groupId);
  const joinedOn = useJoinedOn(groupId);
  const today = todayIso();
  const join = memberId ? joinedOn(memberId) : '';
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

/**
 * The pre-submit / pre-approve check for one request (same rule as the server at approval).
 * `ignoreId` leaves the request being decided out of "other leave".
 */
export function useLeaveCheck(
  groupId: string,
  req: {
    memberId: string;
    typeId: string | null;
    startDay: string;
    endDay: string;
    halfDay: boolean;
    ignoreId?: string;
  },
): (LeaveCheck & { type: MirrorLeaveType }) | null {
  const cal = useCalendar(groupId);
  const joinedOn = useJoinedOn(groupId);
  const type = cal.leaveTypes.find((t) => t.id === req.typeId);
  if (!type || !req.memberId || req.endDay < req.startDay) return null;
  const uses: MirrorLeave[] = cal.leave.filter(
    (l) => l.memberId === req.memberId && l.leaveTypeId === type.id && l.id !== req.ignoreId,
  );
  const check = leaveCheck({
    rule: ruleOf(type),
    allowOverdraw: type.allowOverdraw,
    joinedOn: joinedOn(req.memberId),
    uses,
    request: req,
  });
  return { ...check, type };
}

/** 1, 1.5, 0.5 ... without a trailing .0 */
export const daysText = (n: number): string => String(Math.round(n * 100) / 100);

function useLeaveTypeMutation<T extends object>(groupId: string, kind: MutationKind) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: T) => mutate(kind, groupId, { ...input } as Record<string, unknown>),
  });
}
export const useSetLeaveType = (g: string) =>
  useLeaveTypeMutation<CompanyLeaveTypeSetPayload>(g, MutationKind.CompanyLeaveTypeSet);
export const useRemoveLeaveType = (g: string) =>
  useLeaveTypeMutation<{ id: string }>(g, MutationKind.CompanyLeaveTypeRemove);
