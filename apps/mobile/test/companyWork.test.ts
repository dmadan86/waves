import { describe, expect, it } from 'vitest';

import {
  addTaskError,
  addTaskPayloads,
  advanceWorkStatus,
  countWork,
  formatWorkTime,
  filterWork,
  groupWorkTasks,
  maxTaskDay,
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
  it('filters by search and site', () => {
    expect(
      filterWork([task('1', 'todo'), task('2', 'done')], { search: 'sweep', siteId: 's1' }),
    ).toHaveLength(2);
    expect(filterWork([task('1', 'todo')], { search: 'sweep', siteId: 's2' })).toHaveLength(0);
    expect(
      filterWork([task('1', 'todo')], { search: 'asha', personName: () => 'Asha' }),
    ).toHaveLength(1);
  });
  it('groups by date: overdue first, today next, old done tasks in one tail', () => {
    const t = (id: string, day: string, status: MirrorWorkTask['status'], title = id) => ({
      ...task(id, status),
      day,
      title,
      dueTime: null,
    });
    const out = groupWorkTasks(
      [
        t('a', '2026-10-29', 'todo'),
        t('b', '2026-10-30', 'doing'),
        t('c', '2026-10-31', 'done'),
        t('d', '2026-10-31', 'todo'),
        t('e', '2026-10-31', 'blocked'),
        t('f', '2026-10-28', 'done'),
        t('g', '2026-11-02', 'todo'),
      ],
      { mode: 'date', today: '2026-10-31' },
    );
    expect(out.sections.map((s) => [s.kind, s.ref, s.tasks.map((x) => x.id)])).toEqual([
      ['overdue', '', ['b', 'a']],
      ['day', '2026-10-31', ['e', 'd', 'c']],
      ['day', '2026-11-02', ['g']],
    ]);
    expect(out.done.map((x) => x.id)).toEqual(['f']);
  });
  it('groups by person with open and alert counts', () => {
    const mk = (id: string, memberId: string, day: string, status: MirrorWorkTask['status']) => ({
      ...task(id, status),
      memberId,
      day,
    });
    const out = groupWorkTasks(
      [
        mk('1', 'b', '2026-10-31', 'todo'),
        mk('2', 'a', '2026-10-30', 'todo'),
        mk('3', 'a', '2026-10-31', 'blocked'),
        mk('4', 'a', '2026-10-31', 'done'),
      ],
      { mode: 'person', today: '2026-10-31', personName: (id) => (id === 'a' ? 'Zed' : 'Amy') },
    );
    expect(out.sections.map((s) => [s.ref, s.open, s.alert])).toEqual([
      ['b', 1, 0],
      ['a', 2, 2],
    ]);
  });
  it('lets a deadline run two years ahead', () => {
    expect(maxTaskDay('2026-10-31')).toBe('2028-10-30');
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
  it('allows a deadline from today up to the limit, never the past', () => {
    expect(addTaskError({ ...base, day: '2026-11-07' })).toBeNull();
    expect(addTaskError({ ...base, day: '2026-10-30' })).toBe('day');
    expect(addTaskError({ ...base, day: '2026-11-08' })).toBe('day');
  });
});
