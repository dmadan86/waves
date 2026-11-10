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
      uses: [],
      request: { startDay: '2026-05-04', endDay: '2026-05-08', halfDay: false },
    });
    expect(r).toEqual({ days: 5, available: 5, ok: true });
  });
  const day = (startDay: string): LeaveUse => ({
    startDay,
    endDay: startDay,
    halfDay: false,
    status: 'approved',
  });
  const one = (over: Partial<LeaveBalanceRule>, uses: LeaveUse[], startDay: string) =>
    leaveCheck({
      rule: { ...rule, ...over },
      allowOverdraw: false,
      joinedOn: '2026-01-01',
      uses,
      request: { startDay, endDay: startDay, halfDay: false },
    }).ok;
  it('cannot spend what later approved leave already took (annual cap 1: March taken, then February)', () => {
    expect(one({ annualCap: 1 }, [day('2026-03-02')], '2026-02-02')).toBe(false);
    expect(one({ annualCap: 2 }, [day('2026-03-02')], '2026-02-02')).toBe(true);
  });
  it('a December request is checked against December, not the January it is decided in', () => {
    const noCarry = { annualCap: 1, carryForward: false };
    expect(one(noCarry, [day('2026-12-01')], '2026-12-02')).toBe(false);
    expect(one({ ...noCarry, carryForward: true }, [day('2026-12-01')], '2026-12-02')).toBe(false);
  });
  it('a request before the type or the person started has nothing to draw on', () => {
    expect(one({ startDay: '2026-06-01' }, [], '2026-03-02')).toBe(false);
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
