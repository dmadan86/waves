import { describe, expect, it } from 'vitest';

import {
  asEmploymentType,
  attendanceToday,
  balanceTone,
  DEFAULT_PEOPLE_FILTER,
  listPeople,
  type PeopleRow,
  type PeopleSort,
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
    departmentId: null,
    mark: null,
    tasks: 0,
    balance: { kind: 'settled', amount: 0n },
    ...over,
  });
  const rows = [
    row('Zed', { mark: 'absent', tasks: 5, balance: { kind: 'owesCompany', amount: 300n } }),
    row('Amy', { mark: 'present', tasks: 1, balance: { kind: 'companyOwes', amount: 900n } }),
    row('Bob', { role: 'manager', departmentId: 'd1' }),
    row('Own', { role: 'owner', balance: null }),
    row('Gone', { former: true }),
  ];
  const names = (f = DEFAULT_PEOPLE_FILTER, sort: PeopleSort = 'name', q = '') =>
    listPeople(rows, f, sort, q).map((r) => r.id);

  it('defaults to employed employees and managers, no owners', () => {
    expect(names()).toEqual(['Amy', 'Bob', 'Zed']);
  });
  it('shows owners only when picked, former only under Not employed', () => {
    expect(names({ ...DEFAULT_PEOPLE_FILTER, roles: ['owner'] })).toEqual(['Own']);
    expect(names({ ...DEFAULT_PEOPLE_FILTER, status: 'notEmployed' })).toEqual(['Gone']);
  });
  it("filters by department and today's mark (unmarked = no mark)", () => {
    expect(names({ ...DEFAULT_PEOPLE_FILTER, departmentId: 'd1' })).toEqual(['Bob']);
    expect(names({ ...DEFAULT_PEOPLE_FILTER, mark: 'unmarked' })).toEqual(['Bob']);
    expect(names({ ...DEFAULT_PEOPLE_FILTER, mark: 'absent' })).toEqual(['Zed']);
  });
  it('sorts by attendance, balance and tasks, ties by name', () => {
    expect(names(DEFAULT_PEOPLE_FILTER, 'attendance')).toEqual(['Amy', 'Zed', 'Bob']);
    expect(names(DEFAULT_PEOPLE_FILTER, 'balance')).toEqual(['Amy', 'Zed', 'Bob']);
    expect(names(DEFAULT_PEOPLE_FILTER, 'tasks')).toEqual(['Zed', 'Amy', 'Bob']);
  });
  it('searches by name', () => {
    expect(names(DEFAULT_PEOPLE_FILTER, 'name', ' ze ')).toEqual(['Zed']);
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
