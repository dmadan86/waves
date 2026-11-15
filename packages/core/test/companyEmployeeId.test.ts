import { describe, expect, it } from 'vitest';
import { employeeIdTaken, normaliseEmployeeId, EMPLOYEE_ID_MAX } from '../src';

describe('employee id', () => {
  it('trims, treats blank as none and caps the length', () => {
    expect(normaliseEmployeeId('  EMP-014 ')).toBe('EMP-014');
    expect(normaliseEmployeeId('   ')).toBeNull();
    expect(normaliseEmployeeId(null)).toBeNull();
    expect(normaliseEmployeeId('x'.repeat(40))).toHaveLength(EMPLOYEE_ID_MAX);
  });

  const people = [
    { id: 'a', employee_id: 'EMP-014' },
    { id: 'b', employee_id: 'EMP-015', left_at: '2026-01-01T00:00:00Z' },
    { id: 'c', employee_id: null },
  ];
  it('finds a duplicate, ignoring case, spaces, self and people who left', () => {
    expect(employeeIdTaken(people, ' emp-014 ')).toBe(true);
    expect(employeeIdTaken(people, 'EMP-014', 'a')).toBe(false);
    expect(employeeIdTaken(people, 'EMP-015')).toBe(false);
    expect(employeeIdTaken(people, '')).toBe(false);
  });
});
