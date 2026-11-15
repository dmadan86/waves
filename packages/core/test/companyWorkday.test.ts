import { describe, expect, it } from 'vitest';
import {
  allowanceAmount,
  blockedBy,
  attendanceDaysText,
  emptyMirror,
  MAX_ATTEMPTS,
  nextBatch,
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
      due_time: '17:00:00',
      seq: 42,
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
    const tasks = materialiseWorkTasks(state, q, {
      groupId: 'g',
      now: Date.parse('2026-10-30T01:00:00Z'),
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 't1',
      status: 'blocked',
      blockedReason: 'No cement',
      dueTime: '17:00',
      number: 42,
    });
  });
  it('a manager who loses a person drops their marks and tasks', () => {
    const { state: next } = purgeCompanyInvisible(state, { g: ['a'] });
    expect(Object.keys(next.tables[SyncTable.CompanyWorkTasks])).toEqual(['t1']);
    const { state: none } = purgeCompanyInvisible(state, { g: ['zzz'] });
    expect(Object.keys(none.tables[SyncTable.CompanyAttendance])).toEqual([]);
  });
});

const HOUR = Date.parse('2026-10-30T01:00:00Z');

describe('a task change that keeps failing', () => {
  const doing = reconcile(emptyMirror(), [
    row(SyncTable.CompanyWorkTasks, {
      id: 't9',
      member_id: 'a',
      day: '2026-11-01',
      title: 'File GST',
      project_id: null,
      status: 'doing',
      blocked_reason: null,
      note: null,
      helper_ids: [],
      created_at: '2026-10-30T00:00:00Z',
    }),
  ]).state;
  const tick = (attempts: number, taskId = 't9') =>
    ({
      ...queued(
        'company_work.set',
        {
          taskId,
          memberId: 'a',
          day: '2026-11-01',
          title: 'File GST',
          projectId: null,
          status: 'done',
          blockedReason: null,
          note: null,
        },
        1,
      ),
      attempts,
      nextAttemptAt: 0,
    }) as QueuedMutation;
  it('shows over the server task while retrying, then the server truth once it has failed too often', () => {
    const status = (q: QueuedMutation[]) =>
      materialiseWorkTasks(doing, q, { groupId: 'g', now: HOUR })[0]?.status;
    expect(status([tick(MAX_ATTEMPTS - 1)])).toBe('done');
    expect(status([tick(MAX_ATTEMPTS)])).toBe('doing');
  });
  it('keeps a task only this phone knows about, however often sending failed', () => {
    expect(
      materialiseWorkTasks(doing, [tick(MAX_ATTEMPTS, 'new')], { groupId: 'g', now: HOUR }),
    ).toHaveLength(2);
  });
  it('stops overlaying a change that sat unsent for a day, but keeps a task only this phone has', () => {
    const later = Date.parse('2026-10-30T00:00:00Z') + 25 * HOUR;
    expect(materialiseWorkTasks(doing, [tick(0)], { groupId: 'g', now: later })[0]?.status).toBe(
      'doing',
    );
    expect(
      materialiseWorkTasks(doing, [tick(0, 'new')], { groupId: 'g', now: later }),
    ).toHaveLength(2);
  });
  it('a failing change on one task does not block another task, but keeps order within a task', () => {
    const a = { ...tick(3), nextAttemptAt: 10_000_000 } as QueuedMutation;
    const b = { ...tick(0, 'other'), clientMutationId: 'mb', seq: 2 } as QueuedMutation;
    const a2 = { ...tick(0), clientMutationId: 'ma2', seq: 3 } as QueuedMutation;
    expect(nextBatch([a, b, a2], { now: 1 }).map((m) => m.clientMutationId)).toEqual(['mb']);
    expect(blockedBy([a, b, a2], { now: 1 }).get('ma2')?.clientMutationId).toBe('m1');
  });
  it('a stalled group-wide change still blocks the tasks behind it', () => {
    const create = {
      ...queued('expense.create', { expenseId: 'e1' }, 1),
      attempts: 1,
      nextAttemptAt: 10_000_000,
    } as QueuedMutation;
    expect(nextBatch([create, tick(0, 't1')], { now: 1 })).toEqual([]);
  });
  it('a refused change on one document does not block task changes', () => {
    const doc = {
      ...queued('company_doc.status', { docId: 'd1', status: 'sent' }, 1),
      rejection: { code: 'NOT_ALLOWED' },
    } as unknown as QueuedMutation;
    const again = { ...queued('company_doc.void', { docId: 'd1' }, 3) } as QueuedMutation;
    const out = nextBatch([doc, { ...tick(0, 't1'), seq: 2 } as QueuedMutation, again], { now: 1 });
    expect(out.map((m) => m.kind)).toEqual(['company_work.set']);
  });
  it('is sent again after the ceiling instead of staying stuck', () => {
    expect(nextBatch([tick(MAX_ATTEMPTS + 3)], { now: 1 })).toHaveLength(1);
  });
});
