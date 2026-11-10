import { describe, expect, it } from 'vitest';
import { leaveCheck, type LeaveBalanceRule, type LeaveUse } from '../src/company/leaveBalance';
import { workedDaysText } from '../src/company/workday';

const rule: LeaveBalanceRule = {
  accrualPerMonth: 1,
  carryForward: true,
  carryForwardCap: null,
  annualCap: null,
  startDay: '2020-01-01',
};

describe('leaveCheck (the pre-submit warning)', () => {
  const check = (days: number, over: { allowOverdraw?: boolean; uses?: LeaveUse[] } = {}) =>
    leaveCheck({
      rule,
      allowOverdraw: over.allowOverdraw ?? false,
      joinedOn: '2026-01-01',
      today: '2026-03-10',
      uses: over.uses ?? [],
      request: { startDay: '2026-03-12', endDay: `2026-03-${11 + days}`, halfDay: false },
    });
  it('passes within the balance and fails beyond it', () => {
    expect(check(3)).toEqual({ days: 3, available: 3, ok: true });
    expect(check(4).ok).toBe(false);
  });
  it('counts other approved leave and honours allow overdraw', () => {
    const taken: LeaveUse = {
      startDay: '2026-02-02',
      endDay: '2026-02-03',
      halfDay: false,
      status: 'approved',
    };
    expect(check(2, { uses: [taken] }).ok).toBe(false);
    expect(check(5, { allowOverdraw: true }).ok).toBe(true);
  });
  it('a request in a later month sees that month’s accrual', () => {
    const r = leaveCheck({
      rule,
      allowOverdraw: false,
      joinedOn: '2026-01-01',
      today: '2026-03-10',
      uses: [],
      request: { startDay: '2026-05-04', endDay: '2026-05-08', halfDay: false },
    });
    expect(r).toEqual({ days: 5, available: 5, ok: true });
  });
});

describe('wage rule: a leave type decides its own paid flag', () => {
  const approved = { memberId: 'a', halfDay: false, status: 'approved' as const };
  const base = {
    holidays: [],
    paidHolidays: false,
    leave: [
      {
        ...approved,
        startDay: '2026-11-05',
        endDay: '2026-11-05',
        kind: 'other' as const,
        paid: true,
      },
      {
        ...approved,
        startDay: '2026-11-06',
        endDay: '2026-11-06',
        kind: 'sick' as const,
        paid: false,
      },
    ],
  };
  it('a paid type counts even with the company switch off; an unpaid type does not with it on', () => {
    expect(workedDaysText([], 'a', '2026-11-05', '2026-11-06', { ...base, paidLeave: false })).toBe(
      '1',
    );
    expect(workedDaysText([], 'a', '2026-11-05', '2026-11-06', { ...base, paidLeave: true })).toBe(
      '1',
    );
  });
});
