/**
 * The rules behind keeping a small copy of every group image on the phone:
 * the thumbnail key, which images the mirror refers to, the prefetch order and
 * budget, LRU eviction, and what leaving a group or pruning drops.
 */

import { describe, expect, it } from 'vitest';

import { SyncTable } from '@waves/core';

import { isThumbPath, thumbPathFor, wantsThumbnail } from '../src/lib/storage/thumbKey';
import {
  collectThumbRefs,
  entriesOfGroup,
  planEviction,
  planPrefetch,
  planPrune,
  runBounded,
  thumbId,
  type ThumbRef,
} from '../src/lib/storage/thumbPlan';

describe('thumbnail key', () => {
  it('sits beside the original under a fixed suffix', () => {
    expect(thumbPathFor('exp-1/a.webp')).toBe('exp-1/a.webp.thumb.jpg');
    expect(isThumbPath('exp-1/a.webp.thumb.jpg')).toBe(true);
    expect(isThumbPath('exp-1/a.webp')).toBe(false);
    expect(isThumbPath('.thumb.jpg')).toBe(false);
  });

  it('is made only for group images, and never for a thumbnail itself', () => {
    expect(wantsThumbnail('expense-attachments', 'exp-1/a.webp')).toBe(true);
    expect(wantsThumbnail('settlement-proofs', 's-1/p.jpg')).toBe(true);
    expect(wantsThumbnail('group-photos', 'g-1/cover.webp')).toBe(true);
    expect(wantsThumbnail('expense-attachments', 'exp-1/a.webp.thumb.jpg')).toBe(false);
    expect(wantsThumbnail('avatars', 'u-1/avatar.webp')).toBe(false);
    expect(wantsThumbnail('captures', 'u-1/c.webp')).toBe(false);
    expect(wantsThumbnail('receipts', 'g-1/r.webp')).toBe(false);
  });
});

function mirror(tables: Partial<Record<SyncTable, Record<string, Record<string, unknown>>>>) {
  return { tables };
}

describe('collectThumbRefs', () => {
  const tables = {
    [SyncTable.Groups]: {
      g1: {
        id: 'g1',
        photo_path: 'g1/cover.webp',
        updated_at: 't1',
        archived_at: null,
        deleted_at: null,
      },
      g2: { id: 'g2', photo_path: null, archived_at: '2026-01-01', deleted_at: null },
      g3: { id: 'g3', photo_path: 'g3/cover.webp', archived_at: null, deleted_at: '2026-01-01' },
    },
    [SyncTable.Expenses]: {
      e1: { id: 'e1', group_id: 'g1', deleted_at: null },
      e2: { id: 'e2', group_id: 'g1', deleted_at: '2026-02-02' },
    },
    [SyncTable.ExpenseAttachments]: {
      a1: {
        id: 'a1',
        group_id: 'g1',
        expense_id: 'e1',
        storage_path: 'e1/a.webp',
        created_at: '2026-03-01',
        deleted_at: null,
      },
      a2: {
        id: 'a2',
        group_id: 'g1',
        expense_id: 'e1',
        storage_path: 'e1/b.webp',
        created_at: '2026-03-02',
        deleted_at: '2026-03-03',
      },
      a3: {
        id: 'a3',
        group_id: 'g1',
        expense_id: 'e2',
        storage_path: 'e2/c.webp',
        created_at: '2026-03-02',
        deleted_at: null,
      },
      a4: {
        id: 'a4',
        group_id: 'g2',
        expense_id: 'e9',
        storage_path: 'e9/d.webp',
        created_at: '2026-03-02',
        deleted_at: null,
      },
    },
    [SyncTable.SettlementProofs]: {
      p1: {
        id: 'p1',
        group_id: 'g1',
        settlement_id: 's1',
        storage_path: 's1/p.jpg',
        created_at: '2026-04-01',
        deleted_at: null,
      },
    },
  };

  it('finds covers, attachments and proofs in active groups only', () => {
    const refs = collectThumbRefs(mirror(tables));
    expect(refs.map((r) => `${r.bucket}:${r.path}`).sort()).toEqual([
      'expense-attachments:e1/a.webp',
      'group-photos:g1/cover.webp',
      'settlement-proofs:s1/p.jpg',
    ]);
  });

  it('signs restricted images by subject and versions an in-place cover', () => {
    const refs = collectThumbRefs(mirror(tables));
    const attachment = refs.find((r) => r.bucket === 'expense-attachments');
    const proof = refs.find((r) => r.bucket === 'settlement-proofs');
    const cover = refs.find((r) => r.bucket === 'group-photos');
    expect(attachment?.subjectId).toBe('e1');
    expect(proof?.subjectId).toBe('s1');
    expect(cover).toMatchObject({ version: 't1', priority: 0, groupId: 'g1' });
  });
});

function ref(path: string, createdAt: string | null, extra: Partial<ThumbRef> = {}): ThumbRef {
  return {
    bucket: 'expense-attachments',
    path,
    groupId: 'g1',
    subjectId: 'e1',
    version: null,
    createdAt,
    priority: 1,
    ...extra,
  };
}

describe('planPrefetch', () => {
  it('orders covers first, then newest first, undated last', () => {
    const plan = planPrefetch(
      [
        ref('old', '2026-01-01'),
        ref('undated', null),
        ref('new', '2026-05-01'),
        ref('cover', null, { bucket: 'group-photos', priority: 0 }),
      ],
      new Map(),
    );
    expect(plan.map((r) => r.path)).toEqual(['cover', 'new', 'old', 'undated']);
  });

  it('dedupes the same image referenced twice', () => {
    const plan = planPrefetch([ref('a', '2026-01-01'), ref('a', '2026-01-02')], new Map());
    expect(plan).toHaveLength(1);
  });

  it('skips what is already cached, and what failed recently', () => {
    const cached = new Map([[thumbId('expense-attachments', 'a'), { bytes: 10, version: null }]]);
    const plan = planPrefetch(
      [ref('a', '2026-01-03'), ref('b', '2026-01-02'), ref('c', '2026-01-01')],
      cached,
      {
        skip: new Set([thumbId('expense-attachments', 'c')]),
      },
    );
    expect(plan.map((r) => r.path)).toEqual(['b']);
  });

  it('refetches a cover whose version moved', () => {
    const cover = ref('g1/cover.webp', null, {
      bucket: 'group-photos',
      version: 'v2',
      priority: 0,
    });
    const id = thumbId('group-photos', 'g1/cover.webp');
    expect(planPrefetch([cover], new Map([[id, { bytes: 10, version: 'v1' }]]))).toHaveLength(1);
    expect(planPrefetch([cover], new Map([[id, { bytes: 10, version: 'v2' }]]))).toHaveLength(0);
  });

  it('stops at the cap, keeping the newest', () => {
    const refs = [ref('a', '2026-01-01'), ref('b', '2026-01-02'), ref('c', '2026-01-03')];
    const plan = planPrefetch(refs, new Map(), { capBytes: 100, estimateBytes: 40 });
    expect(plan.map((r) => r.path)).toEqual(['c', 'b']);
  });

  it('counts cached images at their real size against the cap', () => {
    const cached = new Map([[thumbId('expense-attachments', 'c'), { bytes: 90, version: null }]]);
    const refs = [ref('b', '2026-01-02'), ref('c', '2026-01-03')];
    expect(planPrefetch(refs, cached, { capBytes: 100, estimateBytes: 40 })).toEqual([]);
  });
});

describe('planEviction (LRU)', () => {
  const entries = [
    { id: 'a', bytes: 40, lastUsed: 3 },
    { id: 'b', bytes: 40, lastUsed: 1 },
    { id: 'c', bytes: 40, lastUsed: 2 },
  ];

  it('evicts nothing under the cap', () => {
    expect(planEviction(entries, 120)).toEqual([]);
  });

  it('evicts least recently used first until under the cap', () => {
    expect(planEviction(entries, 80)).toEqual(['b']);
    expect(planEviction(entries, 40)).toEqual(['b', 'c']);
  });

  it('never evicts the thumbnail just written', () => {
    expect(planEviction(entries, 40, 'b')).toEqual(['c', 'a']);
  });
});

describe('forget and prune', () => {
  it('a forgotten group drops exactly its own thumbnails', () => {
    const entries = [
      { id: 'x', groupId: 'g1' },
      { id: 'y', groupId: 'g2' },
      { id: 'z', groupId: 'g1' },
    ];
    expect(entriesOfGroup(entries, 'g1')).toEqual(['x', 'z']);
    expect(entriesOfGroup(entries, 'g9')).toEqual([]);
  });

  it('prunes thumbnails nothing refers to, sparing ones written moments ago', () => {
    const entries = [
      { id: 'live', savedAt: 0 },
      { id: 'gone', savedAt: 0 },
      { id: 'fresh', savedAt: 9_000 },
    ];
    expect(planPrune(entries, new Set(['live']), 10_000, 5_000)).toEqual(['gone']);
  });
});

describe('runBounded', () => {
  it('never runs more than the limit at once, and survives a failing item', async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await runBounded([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (n === 3) throw new Error('bad image');
      done.push(n);
    });
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 4, 5]);
  });
});
