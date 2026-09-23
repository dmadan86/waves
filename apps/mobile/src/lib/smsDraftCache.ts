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
 * A draft is in one of five states:
 *
 *   * **open** — waiting in Review;
 *   * **held** — placed in a group, its expense not yet confirmed by the server;
 *   * **filed** — its expense is confirmed. Only the id and the time it was
 *     caught are kept (every fact is blanked), so Review's "filed this week"
 *     line can count it and the reader never drafts that message again;
 *   * **dismissed** — a tombstone: the id and nothing else;
 *   * unknown — never seen on this device.
 *
 * The ids are `smsCaptureId` — a SHA-256 of the account and the message's
 * dedupe key — so a tombstone says nothing about the message itself.
 */

import { Serial } from '@/sync/serial';

import type { CaptureRow } from '@/data/types';

import type { HeldDraft } from './smsLocalDrafts';

/** One draft as the backend keeps it. */
export interface DraftEntry {
  readonly row: CaptureRow;
  /** Set while its expense is unconfirmed. */
  readonly held: { readonly groupId: string; readonly expenseId: string } | null;
  /** True once its expense is confirmed; the row is then blanked. */
  readonly filed?: boolean;
}

/** Persistence for one device. `null` is a tombstone. */
export interface DraftBackend {
  load(ownerId: string): Promise<Map<string, DraftEntry | null>>;
  write(ownerId: string, captureId: string, entry: DraftEntry | null): Promise<void>;
  forgetOwner(ownerId: string): Promise<void>;
  forgetEverything(): Promise<void>;
}

export type DraftState = 'open' | 'held' | 'filed' | 'dismissed' | null;

const EMPTY_ROWS: readonly CaptureRow[] = [];
const EMPTY_TIMES: readonly string[] = [];

export interface DraftCache {
  /** Load an account's drafts from the backend, once. */
  ensureLoaded(ownerId: string): Promise<void>;
  /** Re-read from the backend — a headless wake-up may have written meanwhile. */
  refresh(ownerId: string): Promise<void>;
  /** Open drafts, newest first; empty until loaded. Stable between writes. */
  openDrafts(ownerId: string): readonly CaptureRow[];
  /** When each filed draft was caught (its `created_at`). Stable between writes. */
  filedCaughtAt(ownerId: string): readonly string[];
  /** Drafts placed in a group whose expense is not confirmed yet. */
  heldDrafts(ownerId: string): Promise<HeldDraft[]>;
  /** Every id this device has a draft, a filing or a tombstone for. */
  handledIds(ownerId: string): Promise<Set<string>>;
  /** Where this id stands on this device. */
  stateOf(ownerId: string, captureId: string): Promise<DraftState>;
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
  /** Its expense is confirmed: blank it, remember only that it was filed. */
  file(ownerId: string, captureId: string): Promise<void>;
  /** Used or dismissed: forget the draft, keep a tombstone. */
  remove(ownerId: string, captureId: string): Promise<void>;
  /** A tombstone for an id this device has never seen; a known id is left alone. */
  markHandled(ownerId: string, captureId: string): Promise<boolean>;
  /** Sign-out: this account's drafts and tombstones, gone. */
  forgetOwner(ownerId: string): Promise<void>;
  forgetEverything(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

const newestFirst = (a: CaptureRow, b: CaptureRow): number =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

/** A filed draft keeps its id and when it was caught; every fact is blanked. */
function blanked(row: CaptureRow): CaptureRow {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    description: '',
    category: null,
    category_meta: null,
    expense_date: '',
    currency: '',
    amount: '0',
    notes: null,
    photo_path: null,
    raw_text: null,
    parsed: null,
    payment_method: null,
    target_group_id: null,
    location: null,
    status: row.status,
    assigned_expense_id: null,
    assigned_group_id: null,
    created_at: row.created_at,
    local: true,
  };
}

function stateOfEntry(entry: DraftEntry | null | undefined): DraftState {
  if (entry === undefined) return null;
  if (entry === null) return 'dismissed';
  if (entry.filed) return 'filed';
  if (entry.held) return 'held';
  return 'open';
}

export function createDraftCache(backend: DraftBackend): DraftCache {
  const serial = new Serial();
  const byOwner = new Map<string, Map<string, DraftEntry | null>>();
  const loading = new Map<string, Promise<void>>();
  const openCache = new Map<string, readonly CaptureRow[]>();
  const filedCache = new Map<string, readonly string[]>();
  const listeners = new Set<() => void>();

  const changed = (ownerId: string): void => {
    openCache.delete(ownerId);
    filedCache.delete(ownerId);
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

  const stateOf = async (ownerId: string, captureId: string): Promise<DraftState> => {
    if (!ownerId) return null;
    const map = await entries(ownerId);
    return stateOfEntry(map.has(captureId) ? map.get(captureId) : undefined);
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
      if (!map) return EMPTY_ROWS;
      let open = openCache.get(ownerId);
      if (!open) {
        open = [...map.values()]
          .filter((entry): entry is DraftEntry => stateOfEntry(entry) === 'open')
          .map((entry) => entry.row)
          .sort(newestFirst);
        openCache.set(ownerId, open);
      }
      return open;
    },

    filedCaughtAt(ownerId) {
      const map = byOwner.get(ownerId);
      if (!map) return EMPTY_TIMES;
      let filed = filedCache.get(ownerId);
      if (!filed) {
        filed = [...map.values()]
          .filter((entry): entry is DraftEntry => stateOfEntry(entry) === 'filed')
          .map((entry) => entry.row.created_at);
        filedCache.set(ownerId, filed);
      }
      return filed;
    },

    async heldDrafts(ownerId) {
      const held: HeldDraft[] = [];
      for (const [captureId, entry] of await entries(ownerId)) {
        if (stateOfEntry(entry) === 'held' && entry?.held) {
          held.push({ captureId, ...entry.held });
        }
      }
      return held;
    },

    async handledIds(ownerId) {
      return new Set((await entries(ownerId)).keys());
    },

    stateOf,

    async isLocalDraft(ownerId, captureId) {
      const state = await stateOf(ownerId, captureId);
      return state === 'open' || state === 'held';
    },

    put(ownerId, row) {
      return writeIf(ownerId, row.id, (current) =>
        current === undefined ? { row: { ...row, local: true }, held: null } : undefined,
      );
    },

    update(ownerId, captureId, next) {
      return writeIf(ownerId, captureId, (current) =>
        stateOfEntry(current) === 'open' && current
          ? { row: { ...next(current.row), local: true }, held: null }
          : undefined,
      );
    },

    async hold(ownerId, captureId, groupId, expenseId) {
      await writeIf(ownerId, captureId, (current) => {
        const state = stateOfEntry(current);
        return (state === 'open' || state === 'held') && current
          ? { row: current.row, held: { groupId, expenseId } }
          : undefined;
      });
    },

    async reopen(ownerId, captureId) {
      await writeIf(ownerId, captureId, (current) =>
        stateOfEntry(current) === 'held' && current ? { row: current.row, held: null } : undefined,
      );
    },

    async file(ownerId, captureId) {
      await writeIf(ownerId, captureId, (current) => {
        const state = stateOfEntry(current);
        return (state === 'open' || state === 'held') && current
          ? { row: blanked(current.row), held: null, filed: true }
          : undefined;
      });
    },

    async remove(ownerId, captureId) {
      await writeIf(ownerId, captureId, (current) => (current === null ? undefined : null));
    },

    markHandled(ownerId, captureId) {
      return writeIf(ownerId, captureId, (current) => (current === undefined ? null : undefined));
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
