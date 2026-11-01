import { describe, expect, it } from 'vitest';

import { buildWorkReport, workRange, type WorkReportLabels } from '../src/data/companyWorkExport';
import type { MirrorWorkTask } from '@/data/companyWorkday';

const labels: WorkReportLabels = {
  titles: { list: 'List', person: 'People', site: 'Sites', overdue: 'Overdue' },
  number: '#',
  task: 'Task',
  person: 'Person',
  site: 'Site',
  date: 'Date',
  status: 'Status',
  open: 'Open',
  done: 'Done',
  overdue: 'Late',
  total: 'Total',
  completion: 'Rate',
  daysLate: 'Days late',
  noSite: 'No site',
  statuses: { todo: 'To do', doing: 'Doing', done: 'Done', blocked: 'Blocked' },
};
const task = (
  id: string,
  memberId: string,
  day: string,
  status: MirrorWorkTask['status'],
  projectId: string | null = null,
): MirrorWorkTask => ({
  id,
  memberId,
  day,
  title: `Task ${id}`,
  projectId,
  status,
  blockedReason: status === 'blocked' ? 'x' : null,
  note: null,
  dueTime: null,
  number: Number(id),
});
const tasks = [
  task('1', 'a', '2026-10-27', 'done', 's1'),
  task('2', 'a', '2026-10-28', 'todo', 's1'),
  task('3', 'b', '2026-10-30', 'blocked'),
  task('4', 'b', '2026-11-03', 'todo'),
  task('5', 'b', '2026-09-01', 'todo'),
];
const base = {
  tasks,
  from: '2026-10-26',
  to: '2026-11-01',
  today: '2026-10-31',
  company: 'Acme',
  generatedOn: '2026-10-31',
  locale: 'en',
  personName: (id: string) => (id === 'a' ? 'Asha' : 'Bala'),
  siteName: () => 'Plant',
  labels,
};
const rows = (r: ReturnType<typeof buildWorkReport>) =>
  r.sections[0]!.rows.map((row) => row.map((c) => c.text));

describe('company work reports', () => {
  it('lists the tasks in the range, oldest first, with their numbers', () => {
    const model = buildWorkReport({ ...base, report: 'list' });
    expect(rows(model)).toEqual([
      ['#1', 'Task 1', 'Asha', 'Plant', '2026-10-27', 'Done'],
      ['#2', 'Task 2', 'Asha', 'Plant', '2026-10-28', 'To do'],
      ['#3', 'Task 3', 'Bala', 'No site', '2026-10-30', 'Blocked'],
    ]);
    expect(model.subtitle).toBe('Acme · 2026-10-26 – 2026-11-01');
  });
  it('counts open, done, overdue and total per person and per site', () => {
    expect(rows(buildWorkReport({ ...base, report: 'person' }))).toEqual([
      ['Asha', '1', '1', '1', '2'],
      ['Bala', '1', '0', '1', '1'],
    ]);
    expect(rows(buildWorkReport({ ...base, report: 'site' }))).toEqual([
      ['No site', '1', '0', '1', '1'],
      ['Plant', '1', '1', '1', '2'],
    ]);
  });
  it('overdue report gives the completion rate and the late tasks with days late', () => {
    const model = buildWorkReport({ ...base, report: 'overdue' });
    expect(model.headline.find(([k]) => k === 'Rate')?.[1]).toBe('33%');
    expect(rows(model).map((r) => [r[0], r[5]])).toEqual([
      ['#2', '3'],
      ['#3', '1'],
    ]);
  });
  it('finds this week (Monday to Sunday) and this month', () => {
    expect(workRange('week', '2026-10-31')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(workRange('month', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
});
