import { describe, expect, it } from 'vitest';

import {
  addTaskError,
  addTaskPayloads,
  advanceWorkStatus,
  countWork,
  formatWorkTime,
  filterWork,
} from '../src/lib/companyWork';
import type { MirrorWorkTask } from '@/data/companyWorkday';

const task = (id: string, status: MirrorWorkTask['status']): MirrorWorkTask => ({
  id,
  memberId: 'm1',
  day: '2026-10-30',
  title: 'Sweep floor',
  projectId: 's1',
  status,
  dueTime: '17:00',
  blockedReason: null,
  note: null,
});

describe('company work helpers', () => {
  it('counts each status and combines todo with blocked as pending', () => {
    expect(
      countWork([task('1', 'todo'), task('2', 'doing'), task('3', 'done'), task('4', 'blocked')]),
    ).toEqual({ total: 4, done: 1, doing: 1, pending: 2, blocked: 1 });
  });
  it('filters by search, site, person and chip', () => {
    expect(
      filterWork([task('1', 'todo'), task('2', 'done')], {
        search: 'sweep',
        siteId: 's1',
        personId: 'm1',
        chip: 'done',
      }),
    ).toHaveLength(1);
  });
  it('advances task status and formats local display time', () => {
    expect(advanceWorkStatus('todo')).toBe('doing');
    expect(advanceWorkStatus('doing')).toBe('done');
    expect(advanceWorkStatus('done')).toBe('todo');
    expect(formatWorkTime('2026-10-30', '17:00', '2026-10-30', 'en-US', 'Today')).toBe(
      'Today, 5:00 PM',
    );
  });
});

describe('add task sheet', () => {
  const base = {
    title: 'Fix the gate',
    memberIds: ['a', 'b'],
    allowed: ['a', 'b', 'c'],
    day: '2026-10-31',
    today: '2026-10-31',
    maxDay: '2026-11-07',
  };
  it('creates one task per selected person with the same title, day and a task id each', () => {
    let n = 0;
    const out = addTaskPayloads({
      title: '  Fix the gate ',
      memberIds: ['a', 'b', 'a'],
      day: base.day,
      idFor: (id) => `${id}-${++n}`,
    });
    expect(out.map((p) => [p.memberId, p.taskId])).toEqual([
      ['a', 'a-1'],
      ['b', 'b-2'],
    ]);
    expect(new Set(out.map((p) => `${p.title}|${p.day}|${p.status}`))).toEqual(
      new Set(['Fix the gate|2026-10-31|todo']),
    );
  });
  it('needs a description, someone to assign to, and only people the viewer may assign', () => {
    expect(addTaskError(base)).toBeNull();
    expect(addTaskError({ ...base, title: '   ' })).toBe('title');
    expect(addTaskError({ ...base, memberIds: [] })).toBe('people');
    expect(addTaskError({ ...base, memberIds: ['a', 'x'] })).toBe('people'); // x is outside the team
  });
  it('allows a deadline from today to a week ahead, never the past', () => {
    expect(addTaskError({ ...base, day: '2026-11-07' })).toBeNull();
    expect(addTaskError({ ...base, day: '2026-10-30' })).toBe('day');
    expect(addTaskError({ ...base, day: '2026-11-08' })).toBe('day');
  });
});
