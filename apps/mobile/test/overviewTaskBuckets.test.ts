import { describe, expect, it } from 'vitest';

import { bucketOverviewTasks } from '../src/lib/companyWork';
import type { MirrorWorkTask } from '@/data/companyWorkday';

const t = (id: string, day: string, status: MirrorWorkTask['status'] = 'todo'): MirrorWorkTask => ({
  id,
  memberId: 'm1',
  day,
  title: id,
  projectId: null,
  status,
  dueTime: null,
  number: null,
  blockedReason: null,
  note: null,
});

describe('bucketOverviewTasks', () => {
  it("splits open tasks into overdue, today, week and later; counts only today's done", () => {
    const b = bucketOverviewTasks(
      [
        t('a', '2026-11-09'),
        t('b', '2026-11-10', 'doing'),
        t('c', '2026-11-17'),
        t('d', '2026-11-18'),
        t('e', '2026-11-10', 'done'),
        t('f', '2026-11-01', 'done'),
      ],
      '2026-11-10',
    );
    expect(b.overdue.map((x) => x.id)).toEqual(['a']);
    expect(b.today.map((x) => x.id)).toEqual(['b']);
    expect(b.week.map((x) => x.id)).toEqual(['c']);
    expect(b.later.map((x) => x.id)).toEqual(['d']);
    expect(b.done).toBe(1);
  });
});
