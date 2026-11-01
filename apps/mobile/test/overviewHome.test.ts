import { describe, expect, it } from 'vitest';

import { buildComingUp, buildNeedRows, greetingFor, taskFacts } from '../src/lib/overviewHome';

const task = (day: string, status: string, dueTime: string | null = null, title = 't') => ({
  day,
  status,
  dueTime,
  title,
});

describe('greeting', () => {
  it('splits the day', () => {
    expect([0, 11, 12, 16, 17, 23].map(greetingFor)).toEqual([
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
    ]);
  });
});

describe('task facts', () => {
  const f = taskFacts(
    [
      task('2026-11-01', 'todo', '09:00', 'a'),
      task('2026-11-01', 'doing', '18:00', 'b'),
      task('2026-10-30', 'todo', null, 'old'),
      task('2026-11-01', 'blocked', null, 'stuck'),
      task('2026-11-01', 'done', '08:00', 'finished'),
      task('2026-11-07', 'todo'),
      task('2026-11-08', 'todo'),
    ],
    '2026-11-01',
    '10:00',
  );
  it('counts open, blocked, overdue and the week', () => {
    expect(f.open).toBe(6);
    expect(f.blocked).toEqual(['stuck']);
    expect(f.overdue.map((t) => t.title)).toEqual(['old', 'a']);
    expect(f.dueThisWeek).toBe(4);
  });
});

describe('need rows and coming up', () => {
  it('hides empty rows', () => {
    const none = taskFacts([], '2026-11-01', '10:00');
    expect(buildNeedRows(none, { count: 0, total: 0n })).toEqual([]);
    const f = taskFacts([task('2026-11-01', 'blocked')], '2026-11-01', '10:00');
    expect(buildNeedRows(f, { count: 3, total: 18000n }).map((r) => r.kind)).toEqual([
      'blocked',
      'approve',
    ]);
  });
  it('falls back to the next event when there is no payroll', () => {
    const ev = { title: 'Offsite', day: '2026-11-03', time: null };
    expect(buildComingUp(null, ev, 2, 0)).toEqual([
      { kind: 'event', ...ev },
      { kind: 'tasks', n: 2 },
    ]);
    expect(buildComingUp({ ...ev, title: 'Pay' }, ev, 0, 1).map((c) => c.kind)).toEqual([
      'payroll',
      'approvals',
    ]);
    expect(buildComingUp(null, null, 0, 0)).toEqual([]);
    // A calendar item's own kind must not replace the card's (it rendered as "NaN to approve").
    const wage = { ...ev, kind: 'money', subKind: 'wage' } as typeof ev;
    expect(buildComingUp(wage, null, 0, 0)).toEqual([{ kind: 'payroll', ...ev }]);
  });
});
