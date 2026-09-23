/**
 * The in-memory face of this device's SMS drafts, over whatever keeps them.
 *
 * Review reads captures synchronously, off a mirror that is already in memory
 * (`useCaptures` is a `useMemo`). Local SMS drafts have to be readable the same
 * way or the merged list would flicker empty on every render, so the drafts
 * are loaded once per account into this cache and every write goes through it
 * — the disk first, then the cache the screen reads, one write at a time.
 *
 * The backend is the only thing that differs between platforms: sealed SQLite
 * on a phone (`smsDraftStore.ts`), memory on web (`smsDraftStore.web.ts`). The
 * rules — what a tombstone is, what "already handled" means, what a held draft
 * is — live here, once, and are tested against a fake backend.
 *
 * A **tombstone** is a capture id with nothing else: the draft was used or
 * dismissed. It is kept so the reader never re-proposes a message somebody
 * already answered — the id is a SHA-256 of the account and the message's
 * dedupe key (`smsCaptureId`), so it says nothing about the message itself.
 */

import { Serial } from '@/sync/serial';

import type { CaptureRow } from '@/data/types';

import type { HeldDraft } from './smsLocalDrafts';

/** One draft as the backend keeps it. `held` is set while its expense is unconfirmed. */
export interface DraftEntry {
  readonly row: CaptureRow;
  readonly held: { readonly groupId: string; readonly expenseId: string } | null;
}

/** Persistence for one device. `null` is a tombstone. */
export interface DraftBackend {
  load(ownerId: string): Promise<Map<string, DraftEntry | null>>;
  write(ownerId: string, captureId: string, entry: DraftEntry | null): Promise<void>;
  forgetOwner(ownerId: string): Promise<void>;
  forgetEverything(): Promise<void>;
}

const EMPTY: readonly CaptureRow[] = [];

export interface DraftCache {
  /** Load an account's drafts from the backend, once. */
  ensureLoaded(ownerId: string): Promise<void>;
  /** Re-read from the backend — a headless wake-up may have written meanwhile. */
  refresh(ownerId: string): Promise<void>;
  /** Open drafts, newest first; empty until loaded. Stable between writes. */
  openDrafts(ownerId: string): readonly CaptureRow[];
  /** Drafts placed in a group whose expense is not confirmed yet. */
  heldDrafts(ownerId: string): Promise<HeldDraft[]>;
  /** Every id this device has a draft or a tombstone for. */
  handledIds(ownerId: string): Promise<Set<string>>;
  /** Is this id an open or held local draft? */
  isLocalDraft(ownerId: string, captureId: string): Promise<boolean>;
  /** Add a draft. False (and nothing written) if the id is already known. */
  put(ownerId: string, row: CaptureRow): Promise<boolean>;
  /** Replace an open draft's row. False if it is not an open local draft. */
  update(
    ownerId: string,
    captureId: string,
    next: (row: CaptureRow) => CaptureRow,
  ): Promise<boolean>;
  /** Placed in a group: hide it from Review until its expense is confirmed. */
  hold(ownerId: string, captureId: string, groupId: string, expenseId: string): Promise<void>;
  /** Its expense was discarded: back to Review. */
  reopen(ownerId: string, captureId: string): Promise<void>;
  /** Used or dismissed: forget the draft, keep a tombstone. */
  remove(ownerId: string, captureId: string): Promise<void>;
  /** Sign-out: this account's drafts and tombstones, gone. */
  forgetOwner(ownerId: string): Promise<void>;
  forgetEverything(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

const newestFirst = (a: CaptureRow, b: CaptureRow): number =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

export function createDraftCache(backend: DraftBackend): DraftCache {
  const serial = new Serial();
  const byOwner = new Map<string, Map<string, DraftEntry | null>>();
  const loading = new Map<string, Promise<void>>();
  const openCache = new Map<string, readonly CaptureRow[]>();
  const listeners = new Set<() => void>();

  const changed = (ownerId: string): void => {
    openCache.delete(ownerId);
    for (const listener of listeners) listener();
  };

  const loadInto = async (ownerId: string): Promise<void> => {
    const loaded = await backend.load(ownerId);
    byOwner.set(ownerId, loaded);
    changed(ownerId);
  };

  const ensureLoaded = async (ownerId: string): Promise<void> => {
    if (!ownerId || byOwner.has(ownerId)) return;
    let pending = loading.get(ownerId);
    if (!pending) {
      pending = serial.run(() => (byOwner.has(ownerId) ? Promise.resolve() : loadInto(ownerId)));
      loading.set(ownerId, pending);
    }
    try {
      await pending;
    } finally {
      loading.delete(ownerId);
    }
  };

  const entries = async (ownerId: string): Promise<Map<string, DraftEntry | null>> => {
    await ensureLoaded(ownerId);
    return byOwner.get(ownerId) ?? new Map();
  };

  /**
   * Decide and write in one turn of the lock, so two callers cannot both see
   * an id as new. The disk first, then the cache: a failed write changes
   * nothing on screen. `decide` returns the entry to write, or `undefined` for
   * "nothing to do".
   */
  const writeIf = async (
    ownerId: string,
    captureId: string,
    decide: (current: DraftEntry | null | undefined) => DraftEntry | null | undefined,
  ): Promise<boolean> => {
    if (!ownerId) return false;
    await ensureLoaded(ownerId);
    return serial.run(async () => {
      const map = byOwner.get(ownerId);
      if (!map) return false;
      const next = decide(map.has(captureId) ? map.get(captureId) : undefined);
      if (next === undefined) return false;
      await backend.write(ownerId, captureId, next);
      map.set(captureId, next);
      changed(ownerId);
      return true;
    });
  };

  return {
    ensureLoaded,

    async refresh(ownerId) {
      if (!ownerId) return;
      await serial.run(() => loadInto(ownerId));
    },

    openDrafts(ownerId) {
      const map = byOwner.get(ownerId);
      if (!map) return EMPTY;
      let open = openCache.get(ownerId);
      if (!open) {
        open = [...map.values()]
          .filter((entry): entry is DraftEntry => entry !== null && entry.held === null)
          .map((entry) => entry.row)
          .sort(newestFirst);
        openCache.set(ownerId, open);
      }
      return open;
    },

    async heldDrafts(ownerId) {
      const held: HeldDraft[] = [];
      for (const [captureId, entry] of await entries(ownerId)) {
        if (entry?.held) held.push({ captureId, ...entry.held });
      }
      return held;
    },

    async handledIds(ownerId) {
      return new Set((await entries(ownerId)).keys());
    },

    async isLocalDraft(ownerId, captureId) {
      if (!ownerId) return false;
      return (await entries(ownerId)).get(captureId) != null;
    },

    put(ownerId, row) {
      return writeIf(ownerId, row.id, (current) =>
        current === undefined ? { row: { ...row, local: true }, held: null } : undefined,
      );
    },

    update(ownerId, captureId, next) {
      return writeIf(ownerId, captureId, (current) =>
        current && !current.held
          ? { row: { ...next(current.row), local: true }, held: null }
          : undefined,
      );
    },

    async hold(ownerId, captureId, groupId, expenseId) {
      await writeIf(ownerId, captureId, (current) =>
        current ? { row: current.row, held: { groupId, expenseId } } : undefined,
      );
    },

    async reopen(ownerId, captureId) {
      await writeIf(ownerId, captureId, (current) =>
        current?.held ? { row: current.row, held: null } : undefined,
      );
    },

    async remove(ownerId, captureId) {
      await writeIf(ownerId, captureId, (current) => (current === null ? undefined : null));
    },

    async forgetOwner(ownerId) {
      if (!ownerId) return;
      await serial.run(async () => {
        await backend.forgetOwner(ownerId);
        byOwner.delete(ownerId);
        changed(ownerId);
      });
    },

    async forgetEverything() {
      await serial.run(async () => {
        await backend.forgetEverything();
        const owners = [...byOwner.keys()];
        byOwner.clear();
        for (const owner of owners) changed(owner);
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
