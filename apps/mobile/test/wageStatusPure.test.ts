import { describe, expect, it } from 'vitest';

import { teamWorkingDays, wageStatus } from '../src/lib/wageStatusPure';

const leave = (
  memberId: string,
  startDay: string,
  endDay: string,
  status = 'approved' as const,
) => ({
  memberId,
  startDay,
  endDay,
  status,
});

describe('wageStatus', () => {
  it('is absent with no worked days, present otherwise', () => {
    expect(wageStatus('a', '', [], '2026-10-27', '2026-11-02')).toBe('absent');
    expect(wageStatus('a', '0', [], '2026-10-27', '2026-11-02')).toBe('absent');
    expect(wageStatus('a', '4.5', [], '2026-10-27', '2026-11-02')).toBe('present');
  });
  it('is leave when approved leave overlaps the period, even with worked days', () => {
    const l = [leave('a', '2026-11-02', '2026-11-05')];
    expect(wageStatus('a', '5', l, '2026-10-27', '2026-11-02')).toBe('leave');
    expect(wageStatus('b', '5', l, '2026-10-27', '2026-11-02')).toBe('present');
  });
  it('ignores pending leave and leave outside the period', () => {
    expect(
      wageStatus(
        'a',
        '3',
        [leave('a', '2026-10-28', '2026-10-28', 'pending' as never)],
        '2026-10-27',
        '2026-11-02',
      ),
    ).toBe('present');
    expect(
      wageStatus('a', '3', [leave('a', '2026-11-03', '2026-11-04')], '2026-10-27', '2026-11-02'),
    ).toBe('present');
  });
});

describe('teamWorkingDays', () => {
  it('counts distinct days with a present or half mark by the team', () => {
    const marks = [
      { memberId: 'a', day: '2026-10-27', status: 'present' as const },
      { memberId: 'b', day: '2026-10-27', status: 'half' as const },
      { memberId: 'a', day: '2026-10-28', status: 'absent' as const },
      { memberId: 'a', day: '2026-11-03', status: 'present' as const },
      { memberId: 'z', day: '2026-10-29', status: 'present' as const },
    ];
    expect(teamWorkingDays(marks, new Set(['a', 'b']), '2026-10-27', '2026-11-02')).toBe(1);
  });
});
