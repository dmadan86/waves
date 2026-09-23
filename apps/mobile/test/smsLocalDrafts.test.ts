/**
 * SMS drafts stay on the phone until they are used.
 *
 * The user found their Android phone's bank-message drafts on an iPad: every
 * draft was a synced capture. These pin the replacement end to end, without a
 * device — the routing (an SMS-derived create never reaches the queue), the
 * local store's rules (tombstones, holds), what happens when a draft is placed
 * in a group or dismissed, and the one-time move that takes the old synced
 * copies off the server.
 */

import { describe, expect, it, vi } from 'vitest';

import { MutationKind, type MirrorCapture, type QueuedMutation } from '@waves/core';

import type { CaptureRow } from '@/data/types';
import { createDraftCache, type DraftBackend, type DraftEntry } from '@/lib/smsDraftCache';
import {
  routeCaptureAssign,
  routeCaptureCreate,
  routeCaptureDelete,
  routeCaptureUpdate,
  SmsDraftNotEditableError,
  type Mutate,
} from '@/lib/smsDraftRouting';
import { moveSyncedSmsDrafts, reconcileHeld } from '@/lib/smsDraftUpkeep';
import {
  capturesToMove,
  draftRowFromPayload,
  heldOutcome,
  isSmsDerived,
  mergeCaptureLists,
  signOutAtRiskCount,
  smsDraftsAsDeviceDrafts,
} from '@/lib/smsLocalDrafts';

const OWNER = 'owner-1';

/** A backend that remembers every write, so a test can see what reached "disk". */
function memoryBackend(): DraftBackend & {
  disk: Map<string, Map<string, DraftEntry | null>>;
  writes: { captureId: string; entry: DraftEntry | null }[];
  failNextWrite: boolean;
} {
  const disk = new Map<string, Map<string, DraftEntry | null>>();
  const backend = {
    disk,
    writes: [] as { captureId: string; entry: DraftEntry | null }[],
    failNextWrite: false,
    async load(ownerId: string) {
      return new Map(disk.get(ownerId) ?? []);
    },
    async write(ownerId: string, captureId: string, entry: DraftEntry | null) {
      if (backend.failNextWrite) {
        backend.failNextWrite = false;
        throw new Error('disk full');
      }
      let map = disk.get(ownerId);
      if (!map) disk.set(ownerId, (map = new Map()));
      map.set(captureId, entry);
      backend.writes.push({ captureId, entry });
    },
    async forgetOwner(ownerId: string) {
      disk.delete(ownerId);
    },
    async forgetEverything() {
      disk.clear();
    },
  };
  return backend;
}

function smsPayload(captureId: string, over: Record<string, unknown> = {}) {
  return {
    captureId,
    description: 'SWIGGY',
    category: 'food',
    expenseDate: '2026-03-10',
    currency: 'INR',
    amount: '45000',
    notes: null,
    photoPath: null,
    rawText: null,
    parsed: {
      source: 'sms',
      channel: 'inbox',
      sender: 'AX-HDFCBK',
      dedupeKey: `key-${captureId}`,
      confidence: 0.9,
      accountTail: '1234',
      dateInferred: false,
    },
    paymentMethod: null,
    targetGroupId: null,
    categoryMeta: null,
    location: null,
    ...over,
  };
}

function mirrorCapture(id: string, over: Partial<MirrorCapture> = {}): MirrorCapture {
  return {
    id,
    owner_user_id: OWNER,
    description: 'BLUE TOKAI',
    category: 'food',
    category_meta: null,
    expense_date: '2026-03-03',
    currency: 'INR',
    amount: '24000',
    notes: null,
    photo_path: null,
    raw_text: null,
    parsed: { source: 'sms', channel: 'inbox', dedupeKey: `key-${id}` },
    payment_method: null,
    target_group_id: null,
    location: null,
    status: 'open',
    assigned_expense_id: null,
    assigned_group_id: null,
    created_at: '2026-03-03T10:00:00.000Z',
    deleted_at: null,
    ...over,
  } as MirrorCapture;
}

function recordingMutate(): Mutate & { calls: { kind: string; payload: unknown }[] } {
  const calls: { kind: string; payload: unknown }[] = [];
  const fn = (async (kind: MutationKind, _scope: string, payload: Record<string, unknown>) => {
    calls.push({ kind, payload });
  }) as Mutate & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

describe('isSmsDerived', () => {
  it('is true only for parsed.source === "sms"', () => {
    expect(isSmsDerived({ source: 'sms' })).toBe(true);
    expect(isSmsDerived({ source: 'voice' })).toBe(false);
    expect(isSmsDerived(null)).toBe(false);
    expect(isSmsDerived('sms')).toBe(false);
  });
});

describe('routing: an SMS draft never becomes a synced capture', () => {
  it('keeps an SMS-derived create on the device and queues nothing', async () => {
    const drafts = createDraftCache(memoryBackend());
    const mutate = recordingMutate();

    const where = await routeCaptureCreate({ ownerId: OWNER, drafts, mutate }, smsPayload('c1'));

    expect(where).toBe('local');
    expect(mutate.calls).toEqual([]);
    expect(drafts.openDrafts(OWNER).map((row) => row.id)).toEqual(['c1']);
    expect(drafts.openDrafts(OWNER)[0]!.local).toBe(true);
  });

  it('keeps a pasted SMS draft local too', async () => {
    const drafts = createDraftCache(memoryBackend());
    const mutate = recordingMutate();
    const pasted = smsPayload('p1', {
      rawText: 'Rs 450 debited at SWIGGY',
      parsed: { source: 'sms', channel: 'paste', dedupeKey: 'k' },
    });

    await routeCaptureCreate({ ownerId: OWNER, drafts, mutate }, pasted);

    expect(mutate.calls).toEqual([]);
  });

  it('still queues an ordinary capture', async () => {
    const drafts = createDraftCache(memoryBackend());
    const mutate = recordingMutate();

    await routeCaptureCreate(
      { ownerId: OWNER, drafts, mutate },
      { ...smsPayload('v1'), parsed: { source: 'voice' } },
    );

    expect(mutate.calls.map((call) => call.kind)).toEqual([MutationKind.CaptureCreate]);
    expect(drafts.openDrafts(OWNER)).toEqual([]);
  });

  it('dismissing a local draft deletes it locally and queues nothing', async () => {
    const drafts = createDraftCache(memoryBackend());
    const mutate = recordingMutate();
    await routeCaptureCreate({ ownerId: OWNER, drafts, mutate }, smsPayload('c1'));

    const where = await routeCaptureDelete({ ownerId: OWNER, drafts, mutate }, 'c1');

    expect(where).toBe('local');
    expect(mutate.calls).toEqual([]);
    expect(drafts.openDrafts(OWNER)).toEqual([]);
    // A tombstone, so the reader does not draft the same message again.
    expect(await drafts.handledIds(OWNER)).toEqual(new Set(['c1']));
  });

  it('dismissing a synced capture still queues capture.delete', async () => {
    const drafts = createDraftCache(memoryBackend());
    const mutate = recordingMutate();

    await routeCaptureDelete({ ownerId: OWNER, drafts, mutate }, 'server-1');

    expect(mutate.calls).toEqual([
      { kind: MutationKind.CaptureDelete, payload: { captureId: 'server-1' } },
    ]);
  });

  it('editing a local draft edits it in place and queues nothing', async () => {
    const drafts = createDraftCache(memoryBackend());
    const mutate = recordingMutate();
    await routeCaptureCreate({ ownerId: OWNER, drafts, mutate }, smsPayload('c1'));
    const created = drafts.openDrafts(OWNER)[0]!.created_at;

    await routeCaptureUpdate(
      { ownerId: OWNER, drafts, mutate },
      'c1',
      smsPayload('c1', { description: 'Swiggy dinner', amount: '50000' }),
    );

    expect(mutate.calls).toEqual([]);
    const row = drafts.openDrafts(OWNER)[0]!;
    expect(row.description).toBe('Swiggy dinner');
    expect(row.amount).toBe('50000');
    expect(row.created_at).toBe(created);
  });

  it('placing a local draft in a group: the expense syncs, the draft is filed once it lands', async () => {
    const drafts = createDraftCache(memoryBackend());
    const mutate = recordingMutate();
    await routeCaptureCreate({ ownerId: OWNER, drafts, mutate }, smsPayload('c1'));

    // The screen queues the expense itself — the ordinary path…
    await mutate(MutationKind.ExpenseCreate, 'group-1', { expenseId: 'e1' });
    // …and closes the draft against it.
    const where = await routeCaptureAssign(
      { ownerId: OWNER, drafts, mutate },
      { captureId: 'c1', groupId: 'group-1', expenseId: 'e1' },
    );

    // Only the expense went to the queue; no capture.assign, no capture at all.
    expect(where).toBe('local');
    expect(mutate.calls.map((call) => call.kind)).toEqual([MutationKind.ExpenseCreate]);
    // Off Review straight away…
    expect(drafts.openDrafts(OWNER)).toEqual([]);

    // …and once the server has the expense, the draft is filed for good.
    const queue = [{ payload: { expenseId: 'e1' } }] as unknown as QueuedMutation[];
    const missing = new Map<string, (string | null)[]>();
    await reconcileHeld({
      ownerId: OWNER,
      drafts,
      isConfirmed: () => false,
      queue,
      syncMark: 't1',
      missing,
    });
    expect(await drafts.heldDrafts(OWNER)).toHaveLength(1);

    await reconcileHeld({
      ownerId: OWNER,
      drafts,
      isConfirmed: (id) => id === 'e1',
      queue: [],
      syncMark: 't2',
      missing,
    });
    expect(await drafts.heldDrafts(OWNER)).toEqual([]);
    expect(drafts.openDrafts(OWNER)).toEqual([]);
    expect(await drafts.isLocalDraft(OWNER, 'c1')).toBe(false);
    expect(await drafts.stateOf(OWNER, 'c1')).toBe('filed');
    // A filed draft keeps when it was caught (for "filed this week") and no fact.
    expect(drafts.filedCaughtAt(OWNER)).toHaveLength(1);
  });

  it('a create for a draft this phone already has is a duplicate, and does not count', async () => {
    const drafts = createDraftCache(memoryBackend());
    const mutate = recordingMutate();
    const deps = { ownerId: OWNER, drafts, mutate };

    expect(await routeCaptureCreate(deps, smsPayload('c1'))).toBe('local');
    expect(await routeCaptureCreate(deps, smsPayload('c1'))).toBe('duplicate');
    await routeCaptureDelete(deps, 'c1');
    expect(await routeCaptureCreate(deps, smsPayload('c1'))).toBe('duplicate');
    expect(mutate.calls).toEqual([]);
  });

  it('an edit to a draft already placed in a group is refused out loud, never dropped or sent', async () => {
    const drafts = createDraftCache(memoryBackend());
    const mutate = recordingMutate();
    const deps = { ownerId: OWNER, drafts, mutate };
    await routeCaptureCreate(deps, smsPayload('c1'));
    await routeCaptureAssign(deps, { captureId: 'c1', groupId: 'g', expenseId: 'e1' });

    await expect(
      routeCaptureUpdate(deps, 'c1', smsPayload('c1', { description: 'late edit' })),
    ).rejects.toBeInstanceOf(SmsDraftNotEditableError);
    // And never a capture.update for a row the server does not have.
    expect(mutate.calls).toEqual([]);

    await routeCaptureDelete(deps, 'c1');
    await expect(routeCaptureUpdate(deps, 'c1', smsPayload('c1'))).rejects.toBeInstanceOf(
      SmsDraftNotEditableError,
    );
    expect(mutate.calls).toEqual([]);
  });
});

describe('held drafts: a refusal is not a deletion', () => {
  function heldHarness() {
    const drafts = createDraftCache(memoryBackend());
    const missing = new Map<string, (string | null)[]>();
    const run = (syncMark: string, isConfirmed: (id: string) => boolean = () => false) =>
      reconcileHeld({ ownerId: OWNER, drafts, isConfirmed, queue: [], syncMark, missing });
    return { drafts, run };
  }

  it('brings a draft back when its expense was discarded — only after two further syncs', async () => {
    const { drafts, run } = heldHarness();
    await drafts.put(OWNER, draftRowFromPayload(OWNER, smsPayload('c1'), '2026-03-10T00:00:00Z'));
    await drafts.hold(OWNER, 'c1', 'group-1', 'e1');

    // Not in the mirror, not on the queue — but an acknowledged expense whose
    // group has not been pulled yet looks exactly like that, so it waits…
    await run('t1');
    await run('t1');
    await run('t2');
    expect(drafts.openDrafts(OWNER)).toEqual([]);

    // …and only still missing after a second further sync does it come back.
    await run('t3');
    expect(drafts.openDrafts(OWNER).map((row) => row.id)).toEqual(['c1']);
  });

  it('files, never reopens, a draft whose expense shows up late', async () => {
    const { drafts, run } = heldHarness();
    await drafts.put(OWNER, draftRowFromPayload(OWNER, smsPayload('c1'), '2026-03-10T00:00:00Z'));
    await drafts.hold(OWNER, 'c1', 'group-1', 'e1');

    await run('t1');
    await run('t2'); // one sync that did not bring the group's expenses
    await run('t3', (id) => id === 'e1');

    expect(drafts.openDrafts(OWNER)).toEqual([]);
    expect(await drafts.stateOf(OWNER, 'c1')).toBe('filed');
  });

  it('heldOutcome: file when confirmed, wait while queued, missing otherwise', () => {
    const held = { captureId: 'c1', groupId: 'g', expenseId: 'e1' };
    const queued = [{ payload: { expenseId: 'e1' } }] as unknown as QueuedMutation[];
    expect(heldOutcome(held, new Set(['e1']), [])).toBe('file');
    expect(heldOutcome(held, new Set(), queued)).toBe('wait');
    expect(heldOutcome(held, new Set(), [])).toBe('missing');
  });
});

describe('the draft cache', () => {
  it('writes to disk before the screen sees it, and a failed write changes nothing', async () => {
    const backend = memoryBackend();
    const drafts = createDraftCache(backend);
    backend.failNextWrite = true;

    await expect(
      drafts.put(OWNER, draftRowFromPayload(OWNER, smsPayload('c1'), '2026-03-10T00:00:00Z')),
    ).rejects.toThrow('disk full');

    expect(drafts.openDrafts(OWNER)).toEqual([]);
    expect(await drafts.isLocalDraft(OWNER, 'c1')).toBe(false);
  });

  it('will not re-add a draft that was already used or dismissed', async () => {
    const drafts = createDraftCache(memoryBackend());
    const row = draftRowFromPayload(OWNER, smsPayload('c1'), '2026-03-10T00:00:00Z');
    expect(await drafts.put(OWNER, row)).toBe(true);
    await drafts.remove(OWNER, 'c1');

    expect(await drafts.put(OWNER, row)).toBe(false);
    expect(drafts.openDrafts(OWNER)).toEqual([]);
  });

  it('a filed draft keeps no fact about the spend', async () => {
    const backend = memoryBackend();
    const drafts = createDraftCache(backend);
    await drafts.put(OWNER, draftRowFromPayload(OWNER, smsPayload('c1'), '2026-03-10T00:00:00Z'));
    await drafts.hold(OWNER, 'c1', 'g', 'e1');
    await drafts.file(OWNER, 'c1');

    const stored = JSON.stringify(backend.disk.get(OWNER)?.get('c1'));
    for (const fact of ['SWIGGY', '45000', 'AX-HDFCBK', '1234', 'key-c1']) {
      expect(stored).not.toContain(fact);
    }
  });

  it('keeps accounts apart and forgets only the one signing out', async () => {
    const backend = memoryBackend();
    const drafts = createDraftCache(backend);
    await drafts.put(OWNER, draftRowFromPayload(OWNER, smsPayload('a'), '2026-03-10T00:00:00Z'));
    await drafts.put(
      'other',
      draftRowFromPayload('other', smsPayload('b'), '2026-03-10T00:00:00Z'),
    );

    await drafts.forgetOwner(OWNER);

    expect(drafts.openDrafts(OWNER)).toEqual([]);
    expect(backend.disk.has(OWNER)).toBe(false);
    expect(drafts.openDrafts('other').map((row) => row.id)).toEqual(['b']);
  });

  it('notifies subscribers and keeps the open list stable between writes', async () => {
    const drafts = createDraftCache(memoryBackend());
    const listener = vi.fn();
    drafts.subscribe(listener);
    await drafts.put(OWNER, draftRowFromPayload(OWNER, smsPayload('a'), '2026-03-10T00:00:00Z'));

    expect(listener).toHaveBeenCalled();
    expect(drafts.openDrafts(OWNER)).toBe(drafts.openDrafts(OWNER));
  });
});

describe('mergeCaptureLists', () => {
  const row = (id: string, created: string, local = false): CaptureRow =>
    ({ id, created_at: created, local }) as CaptureRow;

  it('puts local drafts beside synced captures, newest first, the local copy winning an id', () => {
    const merged = mergeCaptureLists(
      [row('s1', '2026-03-01'), row('both', '2026-03-02')],
      [row('both', '2026-03-02', true), row('l1', '2026-03-03', true)],
    );
    expect(merged.map((item) => [item.id, item.local])).toEqual([
      ['l1', true],
      ['both', true],
      ['s1', false],
    ]);
  });
});

describe('sign-out: local SMS drafts are the only copy', () => {
  it('counts them among what sign-out would lose', () => {
    expect(
      signOutAtRiskCount({ unsentMutations: 0, unsentReceipts: 0, formDrafts: 0, smsDrafts: 3 }),
    ).toBe(3);
    expect(
      signOutAtRiskCount({ unsentMutations: 2, unsentReceipts: 1, formDrafts: 1, smsDrafts: 3 }),
    ).toBe(7);
    expect(
      signOutAtRiskCount({ unsentMutations: 0, unsentReceipts: 0, formDrafts: 0, smsDrafts: 0 }),
    ).toBe(0);
  });

  it('carries them into the device copy, one entry each', () => {
    const row = draftRowFromPayload(OWNER, smsPayload('c1'), '2026-03-10T09:00:00.000Z');

    expect(smsDraftsAsDeviceDrafts([row])).toEqual([
      { key: 'sms-draft:c1', value: row, savedAt: '2026-03-10T09:00:00.000Z' },
    ]);
  });
});

describe('the one-time move', () => {
  /** Keys of the messages this device read — its own message store. */
  const MINE = new Set(['key-open', 'key-a', 'key-b', 'key-used', 'key-gone', 'key-assigned']);

  function harness(captures: MirrorCapture[], localKeys: ReadonlySet<string> = MINE) {
    const backend = memoryBackend();
    const drafts = createDraftCache(backend);
    const deleted: string[] = [];
    let done = false;
    const input = {
      ownerId: OWNER,
      captures,
      localKeys,
      drafts,
      deleteServerCapture: vi.fn(async (id: string) => {
        deleted.push(id);
      }),
      isDone: async () => done,
      markDone: async () => {
        done = true;
      },
    };
    return { backend, drafts, deleted, input, isDone: () => done };
  }

  it('takes open SMS captures this device read, copying each before queueing its delete', async () => {
    const assigned = mirrorCapture('assigned', { status: 'assigned', assigned_expense_id: 'e9' });
    const typed = mirrorCapture('typed', { parsed: { source: 'voice' } });
    const gone = mirrorCapture('gone', { deleted_at: '2026-03-04T00:00:00Z' });
    const open = mirrorCapture('open');
    const h = harness([assigned, typed, gone, open]);
    h.input.deleteServerCapture.mockImplementation(async (id: string) => {
      // The copy is on disk before the server copy's removal is queued.
      expect(h.backend.disk.get(OWNER)?.get(id)).toBeTruthy();
      h.deleted.push(id);
    });

    const result = await moveSyncedSmsDrafts(h.input);

    expect(result).toEqual({ moved: 1, tombstoned: 2, done: true });
    expect(h.deleted).toEqual(['open']);
    expect(h.drafts.openDrafts(OWNER).map((row) => row.id)).toEqual(['open']);
    // Copied as it was — no body invented.
    expect(h.drafts.openDrafts(OWNER)[0]!.raw_text).toBeNull();
    expect(capturesToMove([assigned, typed, gone, open], MINE).map((c) => c.id)).toEqual(['open']);
  });

  it('never moves another device’s SMS capture onto this one', async () => {
    // Made from a message some other phone read — not in this device's store.
    const theirs = mirrorCapture('theirs', { parsed: { source: 'sms', dedupeKey: 'key-theirs' } });
    // A pasted draft: no proof of where it was made, so not moved either.
    const pasted = mirrorCapture('pasted', {
      parsed: { source: 'sms', channel: 'paste' },
      raw_text: 'Rs 99 debited',
    });
    const h = harness([theirs, pasted]);

    const result = await moveSyncedSmsDrafts(h.input);

    expect(result).toEqual({ moved: 0, tombstoned: 0, done: true });
    expect(h.deleted).toEqual([]);
    expect(h.drafts.openDrafts(OWNER)).toEqual([]);
    expect(await h.drafts.handledIds(OWNER)).toEqual(new Set());
  });

  it('writes tombstones for this device’s already-answered SMS captures, so a scrub cannot bring them back', async () => {
    const gone = mirrorCapture('gone', { deleted_at: '2026-03-04T00:00:00Z' });
    const assigned = mirrorCapture('assigned', { status: 'assigned', assigned_expense_id: 'e9' });
    const theirsGone = mirrorCapture('theirs-gone', {
      deleted_at: '2026-03-04T00:00:00Z',
      parsed: { source: 'sms', dedupeKey: 'key-theirs' },
    });
    const h = harness([gone, assigned, theirsGone]);

    await moveSyncedSmsDrafts(h.input);

    expect(await h.drafts.stateOf(OWNER, 'gone')).toBe('dismissed');
    expect(await h.drafts.stateOf(OWNER, 'assigned')).toBe('dismissed');
    expect(await h.drafts.stateOf(OWNER, 'theirs-gone')).toBeNull();
    // Nothing queued for them: they are already answered on the server.
    expect(h.deleted).toEqual([]);
    // And the reader will not draft them again.
    const again = draftRowFromPayload(OWNER, smsPayload('gone'), '2026-03-10T00:00:00Z');
    expect(await h.drafts.put(OWNER, again)).toBe(false);
  });

  it('is idempotent: once done it does nothing, and a re-run never writes twice', async () => {
    const h = harness([mirrorCapture('open')]);
    await moveSyncedSmsDrafts(h.input);
    const writes = h.backend.writes.length;

    const again = await moveSyncedSmsDrafts(h.input);

    expect(again).toEqual({ moved: 0, tombstoned: 0, done: true });
    expect(h.backend.writes.length).toBe(writes);
    expect(h.deleted).toEqual(['open']);
  });

  it('survives an interruption: not marked done, and the next run finishes without duplicating', async () => {
    const h = harness([mirrorCapture('a'), mirrorCapture('b')]);
    h.input.deleteServerCapture.mockImplementationOnce(async () => {
      throw new Error('queue write failed');
    });

    const first = await moveSyncedSmsDrafts(h.input);
    expect(first.done).toBe(false);
    expect(h.isDone()).toBe(false);

    h.input.deleteServerCapture.mockImplementation(async (id: string) => {
      h.deleted.push(id);
    });
    const second = await moveSyncedSmsDrafts(h.input);

    expect(second.done).toBe(true);
    expect(
      h.drafts
        .openDrafts(OWNER)
        .map((row) => row.id)
        .sort(),
    ).toEqual(['a', 'b']);
    // One disk write per draft, however many runs it took.
    expect(h.backend.writes.filter((w) => w.entry !== null).length).toBe(2);
    expect(h.deleted.sort()).toEqual(['a', 'b', 'b']);
  });

  it('still removes the server copy of a draft this phone already answered', async () => {
    const h = harness([mirrorCapture('used')]);
    await h.drafts.remove(OWNER, 'used');

    await moveSyncedSmsDrafts(h.input);

    expect(h.deleted).toEqual(['used']);
    expect(h.drafts.openDrafts(OWNER)).toEqual([]);
  });
});
