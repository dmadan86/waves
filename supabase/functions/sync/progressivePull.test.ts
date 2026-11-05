/**
 * A first sync must not walk every group in one response: a never-synced group
 * (no cursor) is taken newest-activity-first, FRESH_GROUPS_PER_PULL at a time,
 * and the rest wait for the client's hasMore re-sync with no cursor.
 */
import { describe, expect, it } from 'vitest';

import { pull } from './index.ts';

const ME = 'me';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function stub(seqs: Record<string, number>) {
  const rows = Object.entries(seqs).map(([gid, updated_seq]) => ({ id: gid, updated_seq }));
  return {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.gt = () => b;
      b.order = () => b;
      b.in = () => Promise.resolve({ data: table === 'groups' ? rows : [], error: null });
      b.limit = () => Promise.resolve({ data: [], error: null });
      return b;
    },
  } as never;
}

const groupCursors = (c: Record<string, number>) =>
  Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith('0000')));

describe('pull: progressive first sync', () => {
  // group n has updated_seq n, so higher n = more recent.
  const seqs = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [id(i + 1), i + 1]));
  const caller = stub(seqs);
  const all = new Set(Object.keys(seqs));

  it('first pull takes the 8 newest, then the next 8', async () => {
    const first = await pull(caller, new Set(all), {}, ME);
    expect(first.hasMore).toBe(true);
    expect(Object.keys(groupCursors(first.cursors)).sort()).toEqual(
      Array.from({ length: 8 }, (_, i) => id(20 - i)).sort(),
    );

    const second = await pull(caller, new Set(all), groupCursors(first.cursors), ME);
    expect(second.hasMore).toBe(true);
    expect(
      Object.keys(groupCursors(second.cursors)).filter((g) => !(g in first.cursors)),
    ).toHaveLength(8);
    expect(second.cursors[id(12)]).toBe(12);
    expect(second.cursors[id(4)]).toBeUndefined();
  });

  it('always includes non-fresh and offline-created groups', async () => {
    const out = await pull(
      caller,
      new Set(all),
      { [id(1)]: 0.5, [id(2)]: 1 },
      ME,
      new Set([id(3)]),
    );
    const got = groupCursors(out.cursors);
    expect(got[id(1)]).toBeDefined();
    expect(got[id(2)]).toBeDefined();
    expect(got[id(3)]).toBeDefined();
    expect(out.hasMore).toBe(true);
  });

  it('is done once everything has a cursor', async () => {
    const cur = Object.fromEntries(Object.entries(seqs));
    expect((await pull(caller, new Set(all), cur, ME)).hasMore).toBe(false);
  });
});
