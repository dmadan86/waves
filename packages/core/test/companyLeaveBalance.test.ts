import { describe, expect, it } from 'vitest';
import {
  leaveBalance,
  leaveDays,
  type LeaveBalanceRule,
  type LeaveUse,
} from '../src/company/leaveBalance';

const rule = (o: Partial<LeaveBalanceRule> = {}): LeaveBalanceRule => ({
  accrualPerMonth: 1,
  carryForward: true,
  carryForwardCap: null,
  annualCap: null,
  startDay: '2020-01-01',
  ...o,
});
const use = (startDay: string, endDay = startDay, o: Partial<LeaveUse> = {}): LeaveUse => ({
  startDay,
  endDay,
  halfDay: false,
  status: 'approved',
  ...o,
});
const bal = (o: {
  rule?: Partial<LeaveBalanceRule>;
  joinedOn?: string;
  asOf: string;
  uses?: LeaveUse[];
}) =>
  leaveBalance({
    rule: rule(o.rule),
    joinedOn: o.joinedOn ?? '2025-01-01',
    asOf: o.asOf,
    uses: o.uses ?? [],
  });

describe('leaveDays', () => {
  it('counts calendar days inclusive, half day is 0.5, across month ends and leap day', () => {
    expect(leaveDays(use('2026-11-03', '2026-11-05'))).toBe(3);
    expect(leaveDays(use('2028-02-28', '2028-03-01'))).toBe(3);
    expect(leaveDays(use('2026-11-03', '2026-11-03', { halfDay: true }))).toBe(0.5);
  });
});

describe('monthly accrual', () => {
  it('earns the rate for every month up to and including the current one', () => {
    expect(bal({ asOf: '2026-03-10', joinedOn: '2026-01-01' }).balance).toBe(3);
    expect(bal({ asOf: '2026-01-31', joinedOn: '2026-01-01' }).balance).toBe(1);
  });
  it('halves of a day per month', () => {
    expect(
      bal({ rule: { accrualPerMonth: 1.5 }, asOf: '2026-04-01', joinedOn: '2026-01-01' }).balance,
    ).toBe(6);
  });
  it('a mid-month joiner earns that month only when joined on day 15 or earlier', () => {
    expect(bal({ joinedOn: '2026-03-15', asOf: '2026-03-20' }).balance).toBe(1);
    expect(bal({ joinedOn: '2026-03-16', asOf: '2026-03-20' }).balance).toBe(0);
    expect(bal({ joinedOn: '2026-03-16', asOf: '2026-04-01' }).balance).toBe(1);
  });
  it('a type created mid-history earns only from its first month', () => {
    expect(
      bal({ rule: { startDay: '2026-06-20' }, joinedOn: '2024-01-01', asOf: '2026-08-01' }).balance,
    ).toBe(3);
  });
  it('a zero rate earns nothing', () => {
    expect(bal({ rule: { accrualPerMonth: 0 }, asOf: '2026-08-01' }).balance).toBe(0);
  });
});

describe('deductions', () => {
  it('only approved leave reduces the balance; pending and rejected do not', () => {
    const uses = [
      use('2026-02-03', '2026-02-04'),
      use('2026-02-10', '2026-02-10', { status: 'pending' }),
      use('2026-02-11', '2026-02-11', { status: 'rejected' }),
    ];
    const b = bal({ joinedOn: '2026-01-01', asOf: '2026-03-01', uses });
    expect(b.used).toBe(2);
    expect(b.balance).toBe(1);
  });
  it('half days deduct 0.5', () => {
    const b = bal({
      joinedOn: '2026-01-01',
      asOf: '2026-01-20',
      uses: [use('2026-01-05', '2026-01-05', { halfDay: true })],
    });
    expect(b.balance).toBe(0.5);
  });
  it('leave starting after the as-of month is not deducted yet', () => {
    expect(
      bal({ joinedOn: '2026-01-01', asOf: '2026-01-20', uses: [use('2026-03-05')] }).balance,
    ).toBe(1);
  });
  it('can go negative (the SQL approve refuses that unless overdraw is allowed)', () => {
    expect(
      bal({ joinedOn: '2026-01-01', asOf: '2026-01-20', uses: [use('2026-01-05', '2026-01-07')] })
        .balance,
    ).toBe(-2);
  });
});

describe('year boundary', () => {
  const uses = [use('2025-03-03')];
  it('carries the unused balance into the next year when carry forward is on', () => {
    // 2025: 12 earned - 1 used = 11 carried; 2026 Jan earns 1.
    const b = bal({ joinedOn: '2025-01-01', asOf: '2026-01-15', uses });
    expect(b.carriedIn).toBe(11);
    expect(b.balance).toBe(12);
  });
  it('caps the carry forward', () => {
    const b = bal({
      rule: { carryForwardCap: 5 },
      joinedOn: '2025-01-01',
      asOf: '2026-01-15',
      uses,
    });
    expect(b.carriedIn).toBe(5);
    expect(b.balance).toBe(6);
  });
  it('sick style (no carry forward) resets at 1 January', () => {
    const b = bal({
      rule: { carryForward: false },
      joinedOn: '2025-01-01',
      asOf: '2026-01-15',
      uses,
    });
    expect(b.carriedIn).toBe(0);
    expect(b.balance).toBe(1);
  });
  it('carries across more than one year', () => {
    expect(bal({ joinedOn: '2024-01-01', asOf: '2026-01-15' }).balance).toBe(25);
  });
  it('an overdrawn balance carries as a debt only when carry forward is on', () => {
    const over = [use('2025-01-02', '2025-01-06')]; // 5 days against 1 earned in Jan
    expect(bal({ joinedOn: '2025-01-01', asOf: '2025-01-31', uses: over }).balance).toBe(-4);
    expect(bal({ joinedOn: '2025-01-01', asOf: '2026-01-31', uses: over }).carriedIn).toBe(7);
    expect(
      bal({ rule: { carryForward: false }, joinedOn: '2025-01-01', asOf: '2026-01-31', uses: over })
        .balance,
    ).toBe(1);
  });
  it('leave is deducted in the year it starts (Dec 30 - Jan 2)', () => {
    const b = bal({
      joinedOn: '2025-01-01',
      asOf: '2026-01-31',
      uses: [use('2025-12-30', '2026-01-02')],
    });
    expect(b.carriedIn).toBe(12 - 4);
    expect(b.balance).toBe(9);
  });
});

describe('annual cap', () => {
  it('limits what a year can earn', () => {
    const b = bal({ rule: { annualCap: 6 }, joinedOn: '2026-01-01', asOf: '2026-12-31' });
    expect(b.accrued).toBe(6);
    expect(b.balance).toBe(6);
  });
  it('applies per year, carry forward adds on top', () => {
    expect(
      bal({ rule: { annualCap: 6 }, joinedOn: '2025-01-01', asOf: '2026-12-31' }).balance,
    ).toBe(12);
  });
});
