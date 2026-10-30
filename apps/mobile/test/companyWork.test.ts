import { describe, expect, it } from 'vitest';

import { advanceWorkStatus, countWork, formatWorkTime, filterWork } from '../src/lib/companyWork';
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
