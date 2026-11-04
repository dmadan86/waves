import { describe, expect, it } from 'vitest';

import {
  canSetEmployment,
  employeeIdHolder,
  isEmploymentDate,
} from '../src/lib/company/employment';
import { asEmploymentType, listPeople, DEFAULT_PEOPLE_VIEW } from '../src/lib/company/people';

const m = (o: object) =>
  ({ id: 'a', role: 'member', manager_id: null, left_at: null, ...o }) as never;

describe('company ports', () => {
  it('validates employment dates', () => {
    expect(isEmploymentDate('2026-02-30')).toBe(false);
    expect(isEmploymentDate('2026-02-28')).toBe(true);
  });
  it('lets a manager end only their own team', () => {
    const mgr = m({ id: 'm', role: 'manager' });
    expect(canSetEmployment(mgr, m({ id: 'e', manager_id: 'm' }), false)).toBe(true);
    expect(canSetEmployment(mgr, m({ id: 'e', manager_id: 'x' }), false)).toBe(false);
  });
  it('finds a taken employee id case-insensitively', () => {
    expect(employeeIdHolder([{ id: 'a', employee_id: 'EMP-1' }] as never, ' emp-1 ')?.id).toBe('a');
  });
  it('filters people', () => {
    const rows = [
      { id: '1', name: 'B', role: 'employee', former: false },
      { id: '2', name: 'A', role: 'employee', former: false },
      { id: '3', name: 'C', role: 'owner', former: false },
    ] as never;
    expect(listPeople(rows, DEFAULT_PEOPLE_VIEW, '').map((r) => r.name)).toEqual(['A', 'B']);
    expect(asEmploymentType('x')).toBeNull();
  });
});
