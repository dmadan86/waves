import { describe, expect, it } from 'vitest';

import {
  addTaskError,
  addTaskPayloads,
  advanceWorkStatus,
  canChangeTask,
  isOwnTask,
  toggleHelper,
  countWork,
  emptyTasksState,
  formatWorkTime,
  filterWork,
  groupWorkTasks,
  maxTaskDay,
  priorityMark,
  workDueText,
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
  number: 7,
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
  it('finds a task by its number, with or without the hash', () => {
    const list = [task('1', 'todo')];
    expect(filterWork(list, { search: '#7' })).toHaveLength(1);
    expect(filterWork(list, { search: '7' })).toHaveLength(1);
    expect(filterWork(list, { search: '8' })).toHaveLength(0);
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
  it('groups by status: blocked, in progress, to do, done; old done stays in the tail', () => {
    const mk = (id: string, day: string, status: MirrorWorkTask['status']) => ({
      ...task(id, status),
      day,
    });
    const out = groupWorkTasks(
      [
        mk('1', '2026-10-31', 'todo'),
        mk('2', '2026-10-31', 'done'),
        mk('3', '2026-10-30', 'blocked'),
        mk('4', '2026-10-30', 'done'),
        mk('5', '2026-11-01', 'doing'),
      ],
      { mode: 'status', today: '2026-10-31' },
    );
    expect(out.sections.map((s) => [s.ref, s.tasks.map((x) => x.id)])).toEqual([
      ['blocked', ['3']],
      ['doing', ['5']],
      ['todo', ['1']],
      ['done', ['2']],
    ]);
    expect(out.done.map((x) => x.id)).toEqual(['4']);
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

describe('task priority', () => {
  const t = (
    id: string,
    priority: MirrorWorkTask['priority'],
    status: MirrorWorkTask['status'],
  ) => ({
    ...task(id, status),
    priority,
  });
  it('sorts very urgent first, then urgent, within a section', () => {
    const { sections } = groupWorkTasks(
      [t('a', 'normal', 'blocked'), t('b', 'urgent', 'todo'), t('c', 'very_urgent', 'done')],
      { mode: 'date', today: '2026-10-30' },
    );
    expect(sections[0]?.tasks.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
  it('marks ! and !! and shows nothing for normal or old tasks', () => {
    expect(priorityMark('very_urgent')).toBe('!!');
    expect(priorityMark('urgent')).toBe('!');
    expect(priorityMark('normal')).toBe('');
    expect(priorityMark(undefined)).toBe('');
  });
  it('a late open task reads "Late · date"; done or on-time ones do not', () => {
    const args = ['2026-11-02', 'en-US', 'Today', 'Late · {date}'] as const;
    expect(workDueText({ ...task('1', 'todo'), dueTime: null }, ...args)).toBe('Late · Oct 30');
    expect(workDueText({ ...task('1', 'done'), dueTime: null }, ...args)).toBe('Oct 30');
    expect(
      workDueText(
        { ...task('1', 'todo'), dueTime: null },
        '2026-10-30',
        'en-US',
        'Today',
        'Late · {date}',
      ),
    ).toBe('Today');
  });
});

describe('emptyTasksState', () => {
  const team = [{ status: 'todo' }, { status: 'blocked' }, { status: 'blocked' }];
  it('a search wins', () =>
    expect(emptyTasksState({ search: ' x ', scope: 'mine', teamTasks: team }).kind).toBe('search'));
  it('mine hides team tasks and counts their blocked', () =>
    expect(emptyTasksState({ search: '', scope: 'mine', teamTasks: team })).toEqual({
      kind: 'mine',
      blockedInTeam: 2,
    }));
  it('truly nothing', () => {
    expect(emptyTasksState({ search: '', scope: 'mine', teamTasks: [] }).kind).toBe('none');
    expect(emptyTasksState({ search: '', scope: 'team', teamTasks: team }).kind).toBe('none');
  });
});

describe('task helpers', () => {
  const who = (meId: string, allowed: string[] = [], isEmployee = true) => ({
    enabled: true,
    isEmployee,
    meId,
    allowedPerson: (id: string) => allowed.includes(id),
  });
  const t = { memberId: 'resp', helperIds: ['h1', 'h2'] };
  it('the responsible person and a helper may change status; another employee may not', () => {
    expect(canChangeTask(t, who('resp'))).toBe(true);
    expect(canChangeTask(t, who('h2'))).toBe(true);
    expect(canChangeTask(t, who('other'))).toBe(false);
    expect(canChangeTask({ memberId: 'resp' }, who('h1'))).toBe(false);
  });
  it('a manager changes tasks of their own people, helper or not', () => {
    expect(canChangeTask(t, who('boss', ['resp'], false))).toBe(true);
    expect(canChangeTask(t, who('boss', ['x'], false))).toBe(false);
    expect(isOwnTask(t, 'h1')).toBe(true);
    expect(isOwnTask(t, undefined)).toBe(false);
  });
  it('toggleHelper never adds the responsible person, caps at five, and removes on tap', () => {
    expect(toggleHelper(['a'], 'resp', 'resp')).toEqual(['a']);
    expect(toggleHelper(['a'], 'a', 'resp')).toEqual([]);
    expect(toggleHelper(['a', 'b', 'c', 'd', 'e'], 'f', 'resp')).toHaveLength(5);
    expect(toggleHelper(['a'], 'b', 'resp')).toEqual(['a', 'b']);
  });
  it('new tasks carry the helpers except the task owner', () => {
    const [one, two] = addTaskPayloads({
      title: 'x',
      memberIds: ['p', 'q'],
      day: '2026-11-05',
      helperIds: ['p', 'h'],
      idFor: (id) => `t-${id}`,
    });
    expect(one?.helperIds).toEqual(['h']);
    expect(two?.helperIds).toEqual(['p', 'h']);
  });
});
