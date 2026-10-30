import { describe, expect, it } from 'vitest';

import {
  asEmploymentType,
  attendanceToday,
  balancesByMember,
  canSetEmploymentType,
  monthlyBudgets,
  openTasksToday,
} from '../src/data/companyPeople';

const admin = { id: 'o', role: 'admin', left_at: null } as const;
const mgr = { id: 'm', role: 'manager', left_at: null } as const;
const mine = { role: 'member', manager_id: 'm', left_at: null } as const;
const other = { role: 'member', manager_id: 'x', left_at: null } as const;

describe('employment type', () => {
  it('accepts only the three values', () => {
    expect(asEmploymentType('full_time')).toBe('full_time');
    expect(asEmploymentType('intern')).toBeNull();
    expect(asEmploymentType(undefined)).toBeNull();
  });
  it('owner sets anyone, manager only their team, never when suspended or gone', () => {
    expect(canSetEmploymentType(admin, other, false)).toBe(true);
    expect(canSetEmploymentType(mgr, mine, false)).toBe(true);
    expect(canSetEmploymentType(mgr, other, false)).toBe(false);
    expect(canSetEmploymentType({ id: 'e', role: 'member', left_at: null }, mine, false)).toBe(
      false,
    );
    expect(canSetEmploymentType(admin, mine, true)).toBe(false);
    expect(canSetEmploymentType(admin, { ...mine, left_at: '2026-01-01' }, false)).toBe(false);
  });
});

describe('today maps', () => {
  it('counts only today\'s tasks that are not done', () => {
    const t = (memberId: string, day: string, status: string) =>
      ({ id: memberId + day + status, memberId, day, status }) as never;
    const map = openTasksToday(
      [t('a', 'd1', 'todo'), t('a', 'd1', 'doing'), t('a', 'd1', 'done'), t('a', 'd0', 'todo')],
      'd1',
    );
    expect(map.get('a')).toBe(2);
    expect(map.get('b')).toBeUndefined();
  });
  it('reads a mark by member and day', () => {
    const marks = new Map([['a|d1', { status: 'half' }]]) as never;
    expect(attendanceToday(marks, 'a', 'd1')).toBe('half');
    expect(attendanceToday(marks, 'a', 'd2')).toBeNull();
  });
  it('sums this month allocations per manager, skipping deleted', () => {
    const e = (memberId: string, amount: bigint, occurredOn: string, deleted = false) =>
      ({ kind: 'allocation', memberId, amount, occurredOn, deleted }) as never;
    const map = monthlyBudgets(
      [e('m', 100n, '2026-10-02'), e('m', 50n, '2026-10-20'), e('m', 9n, '2026-09-30'), e('m', 7n, '2026-10-03', true)],
      '2026-10',
    );
    expect(map.get('m')).toBe(150n);
  });
  it('gives a settled balance to someone with no entries', () => {
    expect(balancesByMember([], ['a'], '2026-10-30').get('a')).toEqual({
      kind: 'settled',
      amount: 0n,
    });
  });
});
