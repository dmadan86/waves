import { describe, expect, it } from 'vitest';

import {
  asEmploymentType,
  attendanceToday,
  balanceTone,
  DEFAULT_PEOPLE_VIEW,
  listPeople,
  type PeopleRow,
  type PeopleView,
  wholeMoney,
  balancesByMember,
  canSetEmploymentType,
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
  it("counts only today's tasks that are not done", () => {
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
  it('gives a settled balance to someone with no entries', () => {
    expect(balancesByMember([], ['a'], '2026-10-30').get('a')).toEqual({
      kind: 'settled',
      amount: 0n,
    });
  });
});

describe('People list', () => {
  const row = (id: string, over: Partial<PeopleRow> = {}): PeopleRow => ({
    id,
    name: id,
    role: 'employee',
    former: false,
    mark: null,
    tasks: 0,
    balance: { kind: 'settled', amount: 0n },
    ...over,
  });
  const rows = [
    row('Zed'),
    row('Amy'),
    row('Bob', { role: 'manager' }),
    row('Own', { role: 'owner', balance: null }),
    row('Gone', { former: true }),
  ];
  const names = (v: Partial<PeopleView> = {}, q = '') =>
    listPeople(rows, { ...DEFAULT_PEOPLE_VIEW, ...v }, q).map((r) => r.id);

  it('defaults to employees by name', () => {
    expect(names()).toEqual(['Amy', 'Zed']);
  });
  it('shows managers and owners with the admins toggle', () => {
    expect(names({ admins: true })).toEqual(['Amy', 'Bob', 'Own', 'Zed']);
  });
  it('keeps the given order with name sort off', () => {
    expect(names({ byName: false, admins: true })).toEqual(['Zed', 'Amy', 'Bob', 'Own']);
  });
  it('lists only former people in not-employed mode', () => {
    expect(names({ notEmployed: true })).toEqual(['Gone']);
  });
  it('searches by name', () => {
    expect(names({}, ' ze ')).toEqual(['Zed']);
  });
});

describe('People money', () => {
  it('is red only when the person owes the company', () => {
    expect(balanceTone({ kind: 'owesCompany', amount: 5n })).toBe('negative');
    expect(balanceTone({ kind: 'companyOwes', amount: 5n })).toBe('positive');
    expect(balanceTone({ kind: 'settled', amount: 0n })).toBe('positive');
  });
  it('drops .00 but keeps real paise', () => {
    expect(wholeMoney(125000n, 'INR', 'en-IN')).toBe('₹1,250');
    expect(wholeMoney(125050n, 'INR', 'en-IN')).toBe('₹1,250.50');
    expect(wholeMoney(0n, 'INR', 'en-IN')).toBe('₹0');
  });
});
