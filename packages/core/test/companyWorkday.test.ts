import { describe, expect, it } from 'vitest';
import {
  allowanceAmount,
  attendanceDaysText,
  emptyMirror,
  materialiseAttendance,
  materialiseWorkTasks,
  nextAttendance,
  purgeCompanyInvisible,
  reconcile,
  SyncTable,
  workdayCounts,
  type QueuedMutation,
  type SyncChange,
} from '../src';

const mark = (memberId: string, day: string, status: 'present' | 'half' | 'absent') => ({
  memberId,
  day,
  status,
});
let seq = 0;
const row = (table: SyncTable, r: Record<string, unknown>): SyncChange => ({
  table,
  groupId: 'g',
  seq: ++seq,
  row: { group_id: 'g', deleted_at: null, ...r },
});
const queued = (kind: string, payload: Record<string, unknown>, n: number): QueuedMutation =>
  ({
    clientMutationId: `m${n}`,
    kind,
    groupId: 'g',
    payload,
    seq: n,
    clientCreatedAt: '2026-10-30T00:00:00Z',
  }) as unknown as QueuedMutation;

describe('wage days from attendance', () => {
  const marks = [
    mark('a', '2026-10-26', 'present'),
    mark('a', '2026-10-27', 'half'),
    mark('a', '2026-10-28', 'half'),
    mark('a', '2026-10-29', 'absent'),
    mark('a', '2026-11-02', 'present'), // outside the period
    mark('b', '2026-10-26', 'present'),
  ];
  it('present = 1, half = 0.5, absent = 0, only inside the period and the person', () => {
    expect(attendanceDaysText(marks, 'a', '2026-10-26', '2026-11-01')).toBe('2');
    expect(attendanceDaysText(marks, 'a', '2026-10-26', '2026-10-27')).toBe('1.5');
    expect(attendanceDaysText(marks, 'a', '2026-10-29', '2026-10-29')).toBe('');
    expect(attendanceDaysText(marks, 'nobody', '2026-10-26', '2026-11-01')).toBe('');
  });
  it('the prefilled text is a valid wage day count (half days pay half the rate)', () => {
    const days = attendanceDaysText(marks, 'a', '2026-10-26', '2026-10-27');
    expect(allowanceAmount(days, 80000n)).toBe(120000n);
  });
});

describe('attendance cycle and counts', () => {
  it('cycles unmarked -> present -> half -> absent -> unmarked', () => {
    expect(nextAttendance(null)).toBe('present');
    expect(nextAttendance('present')).toBe('half');
    expect(nextAttendance('half')).toBe('absent');
    expect(nextAttendance('absent')).toBeNull();
  });
  it('counts blocked tasks and people not marked today', () => {
    const c = workdayCounts(
      ['a', 'b', 'c'],
      [mark('a', '2026-10-30', 'present'), mark('b', '2026-10-29', 'present')],
      [
        { memberId: 'a', day: '2026-10-30', status: 'blocked' },
        { memberId: 'b', day: '2026-10-30', status: 'done' },
      ],
      '2026-10-30',
    );
    expect(c).toEqual({ blocked: 1, unmarked: 2 });
  });
});

describe('mirror: attendance and work', () => {
  const state = reconcile(emptyMirror(), [
    row(SyncTable.CompanyAttendance, {
      id: 'x',
      member_id: 'a',
      day: '2026-10-30',
      status: 'half',
      note: null,
    }),
    row(SyncTable.CompanyWorkTasks, {
      id: 't1',
      member_id: 'a',
      day: '2026-10-30',
      title: 'Gate',
      project_id: null,
      status: 'todo',
      blocked_reason: null,
      note: null,
    }),
    row(SyncTable.CompanyWorkTasks, {
      id: 't2',
      member_id: 'gone',
      day: '2026-10-30',
      title: 'Old',
      project_id: null,
      status: 'todo',
      blocked_reason: null,
      note: null,
    }),
  ]).state;
  it('queued marks and task edits show at once, a cleared mark disappears', () => {
    const q = [
      queued(
        'company_attendance.set',
        { memberId: 'a', day: '2026-10-30', status: 'present', note: null },
        1,
      ),
      queued(
        'company_attendance.set',
        { memberId: 'b', day: '2026-10-30', status: 'absent', note: null },
        2,
      ),
      queued(
        'company_attendance.set',
        { memberId: 'b', day: '2026-10-30', status: null, note: null },
        3,
      ),
      queued(
        'company_work.set',
        {
          taskId: 't1',
          memberId: 'a',
          day: '2026-10-30',
          title: 'Gate',
          projectId: null,
          status: 'blocked',
          blockedReason: 'No cement',
          note: null,
        },
        4,
      ),
      queued('company_work.remove', { taskId: 't2' }, 5),
    ];
    const att = materialiseAttendance(state, q, { groupId: 'g' });
    expect([...att.keys()]).toEqual(['a|2026-10-30']);
    expect(att.get('a|2026-10-30')?.status).toBe('present');
    const tasks = materialiseWorkTasks(state, q, { groupId: 'g' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 't1', status: 'blocked', blockedReason: 'No cement' });
  });
  it('a manager who loses a person drops their marks and tasks', () => {
    const { state: next } = purgeCompanyInvisible(state, { g: ['a'] });
    expect(Object.keys(next.tables[SyncTable.CompanyWorkTasks])).toEqual(['t1']);
    const { state: none } = purgeCompanyInvisible(state, { g: ['zzz'] });
    expect(Object.keys(none.tables[SyncTable.CompanyAttendance])).toEqual([]);
  });
});
