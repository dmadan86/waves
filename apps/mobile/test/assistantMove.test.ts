import { describe, expect, it, vi } from 'vitest';

import type { MovePlan } from '@/lib/assistantCorrections';
import { runMove, type MoveIo, type MoveProgress } from '@/lib/assistantMove';
import type { SavedState } from '@/lib/followUpApply';

const from = { kind: 'personal', id: 'p1', groupId: null } as unknown as SavedState;
const toGroup = (groupId: string, id: string): MovePlan =>
  ({
    kind: 'toGroup',
    groupId,
    write: { expenseId: id },
    next: { kind: 'group', id, groupId },
  }) as unknown as MovePlan;

function io(over: Partial<MoveIo> = {}) {
  const calls: string[] = [];
  const value: MoveIo = {
    writeDestination: vi.fn(async (p: MovePlan) => void calls.push(`write ${destOf(p)}`)),
    removeSource: vi.fn(async () => void calls.push('removeSource')),
    removeDestination: vi.fn(async (d) => void calls.push(`removeDest ${d.id}`)),
    completed: vi.fn((p: MovePlan) => void calls.push(`completed ${destOf(p)}`)),
    ...over,
  };
  return { io: value, calls };
}
const destOf = (p: MovePlan): string => (p.kind === 'toGroup' ? p.write.expenseId : p.recordId);

describe('resumable move (MV-*)', () => {
  it('MV-01 a failed source delete then a retry writes the destination once and resumes the delete', async () => {
    const progress: { current: MoveProgress | null } = { current: null };
    let fail = true;
    const { io: deps, calls } = io({
      removeSource: vi.fn(async () => {
        if (fail) throw new Error('offline');
        calls.push('removeSource');
      }),
    });
    expect(await runMove(progress, toGroup('g2', 'dest-1'), from, deps)).toBe(false);
    expect(deps.completed).not.toHaveBeenCalled(); // baseRef untouched until the move is whole
    fail = false;
    expect(await runMove(progress, toGroup('g2', 'dest-1'), from, deps)).toBe(true);
    expect(calls.filter((c) => c.startsWith('write'))).toEqual(['write dest-1']);
    expect(calls).toContain('removeSource');
    expect(calls.at(-1)).toBe('completed dest-1');
    expect(progress.current).toBeNull();
  });

  it('MV-02 a retry to a different target takes the stranded destination back out first', async () => {
    const progress: { current: MoveProgress | null } = { current: null };
    let fail = true;
    const { io: deps, calls } = io({
      removeSource: vi.fn(async () => {
        if (fail) throw new Error('offline');
        calls.push('removeSource');
      }),
    });
    await runMove(progress, toGroup('g2', 'dest-1'), from, deps);
    fail = false;
    expect(await runMove(progress, toGroup('g3', 'dest-2'), from, deps)).toBe(true);
    expect(calls).toEqual([
      'write dest-1',
      'removeDest dest-1',
      'write dest-2',
      'removeSource',
      'completed dest-2',
    ]);
  });

  it('MV-03 a failed destination write leaves nothing to resume', async () => {
    const progress: { current: MoveProgress | null } = { current: null };
    const { io: deps } = io({
      writeDestination: vi.fn(async () => {
        throw new Error('x');
      }),
    });
    expect(await runMove(progress, toGroup('g2', 'd'), from, deps)).toBe(false);
    expect(progress.current?.destWritten).toBe(false);
    expect(deps.removeSource).not.toHaveBeenCalled();
  });
});
