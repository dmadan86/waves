import { describe, expect, it } from 'vitest';
import { workedDaysText, type CalendarPayRule } from '../src/company/workday';

const rule = (over: Partial<CalendarPayRule> = {}): CalendarPayRule => ({
  holidays: [{ startDay: '2026-11-03', endDay: '2026-11-04' }],
  leave: [
    {
      memberId: 'a',
      startDay: '2026-11-05',
      endDay: '2026-11-06',
      halfDay: false,
      kind: 'sick',
      status: 'approved',
    },
    {
      memberId: 'a',
      startDay: '2026-11-09',
      endDay: '2026-11-09',
      halfDay: true,
      kind: 'casual',
      status: 'approved',
    },
    {
      memberId: 'a',
      startDay: '2026-11-10',
      endDay: '2026-11-10',
      halfDay: false,
      kind: 'other',
      status: 'approved',
    },
    {
      memberId: 'a',
      startDay: '2026-11-11',
      endDay: '2026-11-11',
      halfDay: false,
      kind: 'sick',
      status: 'pending',
    },
    {
      memberId: 'b',
      startDay: '2026-11-03',
      endDay: '2026-11-03',
      halfDay: false,
      kind: 'sick',
      status: 'approved',
    },
  ],
  paidHolidays: true,
  paidLeave: false,
  ...over,
});
const days = (
  r: CalendarPayRule,
  marks: { memberId: string; day: string; status: 'present' | 'half' | 'absent' }[] = [],
) => workedDaysText(marks, 'a', '2026-11-01', '2026-11-30', r);

describe('workedDaysText', () => {
  it('paid holidays count; approved leave is absent unless paid; pending/other never pay', () => {
    expect(days(rule())).toBe('2'); // two holiday days only
    expect(days(rule({ paidHolidays: false }))).toBe('');
    expect(days(rule({ paidLeave: true }))).toBe('4.5'); // 2 holidays + 2 sick + half casual; other + pending excluded
  });
  it('an attendance mark always wins, including on holidays and leave', () => {
    const marks = [
      { memberId: 'a', day: '2026-11-03', status: 'absent' as const },
      { memberId: 'a', day: '2026-11-05', status: 'present' as const },
    ];
    expect(days(rule(), marks)).toBe('2'); // holiday 4th + marked present on leave day
  });
  it('leave of another person does not apply', () => {
    expect(workedDaysText([], 'b', '2026-11-01', '2026-11-30', rule({ paidLeave: true }))).toBe(
      '2',
    );
  });
});
