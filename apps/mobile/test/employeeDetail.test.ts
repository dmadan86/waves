import { describe, expect, it } from 'vitest';

import { hasHistory, monthCounts, shiftMonth } from '../src/data/employeeDetail';

const mark = (status: 'present' | 'half' | 'absent') => ({ status }) as never;

describe('employee detail helpers', () => {
  it('counts a month by status, leap February included', () => {
    const marks = new Map([
      ['m1|2028-02-29', mark('present')],
      ['m1|2028-02-01', mark('half')],
      ['m1|2028-03-01', mark('absent')],
      ['m2|2028-02-02', mark('absent')],
    ]);
    expect(monthCounts(marks, 'm1', '2028-02')).toEqual({
      present: 1,
      half: 1,
      absent: 0,
      daysInMonth: 29,
    });
  });

  it('shifts months across year ends', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('sees history in marks but not in nothing', () => {
    const marks = new Map([['m1|2026-10-01', mark('present')]]);
    expect(hasHistory('m1', [], marks, [])).toBe(true);
    expect(hasHistory('m2', [], marks, [])).toBe(false);
  });
});
