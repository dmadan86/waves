import { describe, expect, it } from 'vitest';

import {
  canSetEmployment,
  employmentPeople,
  isEmploymentDate,
  isNotEmployed,
} from '../src/data/companyEmployment';

const person = (
  overrides: {
    id?: string;
    role?: 'member' | 'manager' | 'admin' | 'vendor';
    manager_id?: string | null;
    left_at?: string | null;
  } = {},
) => ({
  id: 'member-1',
  role: 'member' as const,
  manager_id: null,
  left_at: null,
  ...overrides,
});

describe('company employment helpers', () => {
  it('recognises left employees and keeps other roles out of the not-employed segment', () => {
    const departed = person({ left_at: '2026-10-01' });
    expect(isNotEmployed(departed)).toBe(true);
    expect(isNotEmployed(person({ role: 'admin', left_at: '2026-10-01' }))).toBe(false);
    expect(employmentPeople([person(), departed], true)).toEqual([departed]);
    expect(employmentPeople([person(), departed], false)).toEqual([person()]);
  });

  it('allows owners and a manager only for their own direct reports', () => {
    const employee = person({ id: 'employee-1', manager_id: 'manager-1' });
    expect(canSetEmployment(person({ role: 'admin' }), employee, false)).toBe(true);
    expect(canSetEmployment(person({ id: 'manager-1', role: 'manager' }), employee, false)).toBe(
      true,
    );
    expect(canSetEmployment(person({ id: 'manager-2', role: 'manager' }), employee, false)).toBe(
      false,
    );
    expect(canSetEmployment(person({ role: 'admin' }), employee, true)).toBe(false);
  });

  it('validates real ISO calendar dates', () => {
    expect(isEmploymentDate('2024-02-29')).toBe(true);
    expect(isEmploymentDate('2025-02-29')).toBe(false);
    expect(isEmploymentDate('2025-13-01')).toBe(false);
  });
});
