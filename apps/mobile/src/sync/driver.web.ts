/**
 * The web store.
 *
 * expo-sqlite's web build is WASM loaded in a worker over OPFS, which needs
 * `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers that
 * neither the dev server nor a plain static export sends. A guest opening an
 * invite link (ADR-006) should not meet a blank screen over that, so web gets
 * AsyncStorage instead. Same interface, same engine, same tests.
 *
 * Unlike the native store (`driver.ts`), the payloads here are NOT encrypted at
 * rest, on purpose. At-rest encryption relies on a key the attacker cannot also
 * read — on device that is the OS keystore. A browser has no such vault: any key
 * this code could reach would sit in the same localStorage/IndexedDB origin as
 * the data, so anyone who can read the data can read the key, and the encryption
 * would protect nothing while adding cost. The browser's own protections (the
 * same-origin sandbox, and OS-level disk encryption of the user's profile) are
 * the layer that applies to web. Web is guest/invite-lite by design; a full,
 * long-lived web client that warranted more would move this to IndexedDB behind
 * the WebCrypto SubtleCrypto non-extractable-key API, which is the browser
 * equivalent of the keystore — a deliberate future step, not this store.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { e2ee } from '@waves/core';
import type { QueuedMutation, SyncTable } from '@waves/core';

import { legacyKeysMigrated } from '@/lib/legacyKeys';

import type { RetainedWork } from './retention';
import { Serial } from './serial';
import type { E2eeOutboxRow, E2eeRecordRow, LocalStore, StoredRow } from './store';

const WEB_KEYS = {
  rows: 'waves:mirror',
  cursors: 'waves:cursors',
  queue: 'waves:queue',
  drafts: 'waves:drafts',
  /** Whose unsent work survived a session ending nobody asked for. */
  retained: 'waves:retained',
} as const;

/** The couple e2ee state is one value so a record and its delivery row commit together. */
const WEB_E2EE_KEY = 'waves:e2ee:store';
const WEB_E2EE_LEGACY_KEYS = {
  records: 'waves:e2ee:records',
  outbox: 'waves:e2ee:outbox',
  pending: 'waves:e2ee:pending',
} as const;
type WebE2eeStore = {
  records: E2eeRecordRow[];
  outbox: E2eeOutboxRow[];
  pending: [string, e2ee.PendingOp[]][];
};
const emptyE2eeStore = (): WebE2eeStore => ({ records: [], outbox: [], pending: [] });

class AsyncStorageStore implements LocalStore {
  // Every entry point below is read-modify-write, so two overlapping callers
  // lose one of the two writes. Same lock as native, for a plainer reason.
  private readonly serial = new Serial();

  async ready(): Promise<void> {
    await legacyKeysMigrated;
  }

  /** `read` for values that may hold bigints (see `encodeJson`). */
  private async readJson<T>(key: string, fallback: T): Promise<T> {
    await legacyKeysMigrated;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    try {
      return e2ee.decodeJson(raw) as T;
    } catch {
      return fallback;
    }
  }

  /** Reads the combined value, migrating the former three-key representation once. */
  private async e2eeStore(): Promise<WebE2eeStore> {
    const raw = await AsyncStorage.getItem(WEB_E2EE_KEY);
    if (raw) {
      try {
        const parsed = e2ee.decodeJson(raw) as Partial<WebE2eeStore>;
        return {
          records: Array.isArray(parsed.records) ? parsed.records : [],
          outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
          pending: Array.isArray(parsed.pending) ? parsed.pending : [],
        };
      } catch {
        return emptyE2eeStore();
      }
    }
    const legacy = {
      records: await this.readJson<E2eeRecordRow[]>(WEB_E2EE_LEGACY_KEYS.records, []),
      outbox: await this.readJson<E2eeOutboxRow[]>(WEB_E2EE_LEGACY_KEYS.outbox, []),
      pending: await this.readJson<[string, e2ee.PendingOp[]][]>(WEB_E2EE_LEGACY_KEYS.pending, []),
    };
    await AsyncStorage.setItem(WEB_E2EE_KEY, e2ee.encodeJson(legacy));
    await AsyncStorage.removeMany(Object.values(WEB_E2EE_LEGACY_KEYS));
    return legacy;
  }

  private writeE2eeStore(store: WebE2eeStore): Promise<void> {
    return AsyncStorage.setItem(WEB_E2EE_KEY, e2ee.encodeJson(store));
  }

  private async read<T>(key: string, fallback: T): Promise<T> {
    await legacyKeysMigrated;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A corrupt blob is not worth crashing over; the next pull rebuilds it.
      return fallback;
    }
  }

  putRows(rows: readonly StoredRow[]): Promise<void> {
    if (rows.length === 0) return Promise.resolve();
    return this.serial.run(async () => {
      const existing = await this.read<StoredRow[]>(WEB_KEYS.rows, []);
      const byKey = new Map(existing.map((row) => [`${row.table}:${row.id}`, row]));
      for (const row of rows) byKey.set(`${row.table}:${row.id}`, row);
      await AsyncStorage.setItem(WEB_KEYS.rows, JSON.stringify([...byKey.values()]));
    });
  }

  deleteRows(keys: readonly { table: SyncTable; id: string }[]): Promise<void> {
    if (keys.length === 0) return Promise.resolve();
    return this.serial.run(async () => {
      const gone = new Set(keys.map((key) => `${key.table}:${key.id}`));
      const rows = await this.read<StoredRow[]>(WEB_KEYS.rows, []);
      await AsyncStorage.setItem(
        WEB_KEYS.rows,
        JSON.stringify(rows.filter((row) => !gone.has(`${row.table}:${row.id}`))),
      );
    });
  }

  readRows(): Promise<StoredRow[]> {
    return this.serial.run(() => this.read<StoredRow[]>(WEB_KEYS.rows, []));
  }

  readCursors(): Promise<Record<string, number>> {
    return this.serial.run(() => this.read<Record<string, number>>(WEB_KEYS.cursors, {}));
  }

  writeCursors(cursors: Record<string, number>): Promise<void> {
    return this.serial.run(() => AsyncStorage.setItem(WEB_KEYS.cursors, JSON.stringify(cursors)));
  }

  readQueue(): Promise<QueuedMutation[]> {
    return this.serial.run(() => this.read<QueuedMutation[]>(WEB_KEYS.queue, []));
  }

  writeQueue(queue: readonly QueuedMutation[]): Promise<void> {
    return this.serial.run(() => AsyncStorage.setItem(WEB_KEYS.queue, JSON.stringify(queue)));
  }

  /** Unlocked on purpose: every caller already holds the lock. */
  private drafts(): Promise<Record<string, { value: unknown; savedAt: string }>> {
    return this.read<Record<string, { value: unknown; savedAt: string }>>(WEB_KEYS.drafts, {});
  }

  readDraft<T>(key: string): Promise<T | null> {
    return this.serial.run(async () => {
      const drafts = await this.drafts();
      return (drafts[key]?.value as T | undefined) ?? null;
    });
  }

  writeDraft(key: string, value: unknown): Promise<void> {
    return this.serial.run(async () => {
      const drafts = await this.drafts();
      drafts[key] = { value, savedAt: new Date().toISOString() };
      await AsyncStorage.setItem(WEB_KEYS.drafts, JSON.stringify(drafts));
    });
  }

  clearDraft(key: string): Promise<void> {
    return this.serial.run(async () => {
      const drafts = await this.drafts();
      delete drafts[key];
      await AsyncStorage.setItem(WEB_KEYS.drafts, JSON.stringify(drafts));
    });
  }

  listDrafts(): Promise<{ key: string; value: unknown; savedAt: string }[]> {
    return this.serial.run(async () => {
      const drafts = await this.drafts();
      return Object.entries(drafts)
        .map(([key, entry]) => ({ key, value: entry.value, savedAt: entry.savedAt }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    });
  }

  forgetGroup(groupId: string, queue: readonly QueuedMutation[]): Promise<void> {
    return this.serial.run(async () => {
      // AsyncStorage has no cross-key transaction, so web cannot make these three
      // writes atomic the way SQLite does — but the web store is best-effort by
      // design (a torn write is rebuilt by the next pull), so consolidating the
      // three writes here is as far as it goes; a journal would be a new
      // mechanism for a loss the next sync already heals.
      const rows = await this.read<StoredRow[]>(WEB_KEYS.rows, []);
      await AsyncStorage.setItem(
        WEB_KEYS.rows,
        JSON.stringify(rows.filter((row) => row.groupId !== groupId)),
      );
      const cursors = await this.read<Record<string, number>>(WEB_KEYS.cursors, {});
      delete cursors[groupId];
      await AsyncStorage.setItem(WEB_KEYS.cursors, JSON.stringify(cursors));
      await AsyncStorage.setItem(WEB_KEYS.queue, JSON.stringify(queue));
    });
  }

  reset(): Promise<void> {
    return this.serial.run(() => AsyncStorage.removeMany(Object.values(WEB_KEYS)));
  }

  /**
   * The same line native draws (see `driver.ts`): drop what the server will
   * hand back, keep what only this browser has, and stamp whose it is.
   *
   * There is no key to keep here — the web store is plaintext on purpose, for
   * the reason at the top of this file — so the trade this makes on native does
   * not arise. What does carry over is the owner stamp, because the rule it
   * enforces is not about encryption: a queue must never drain into an account
   * that did not write it, and a shared browser is exactly where that would
   * otherwise happen.
   */
  retainUnsent(ownerId: string, retainedAt: string): Promise<void> {
    return this.serial.run(async () => {
      await AsyncStorage.removeMany([WEB_KEYS.rows, WEB_KEYS.cursors]);
      await AsyncStorage.setItem(WEB_KEYS.retained, JSON.stringify({ ownerId, retainedAt }));
    });
  }

  readRetained(): Promise<RetainedWork | null> {
    return this.serial.run(async () => {
      const held = await this.read<RetainedWork | null>(WEB_KEYS.retained, null);
      // A blob that parsed but is not a stamp claims nothing (see
      // `retentionVerdict`: an unattributable hold is discarded, not adopted).
      return held && typeof held.ownerId === 'string' && typeof held.retainedAt === 'string'
        ? held
        : null;
    });
  }

  clearRetained(): Promise<void> {
    return this.serial.run(() => AsyncStorage.removeItem(WEB_KEYS.retained));
  }

  writeE2eeRecords(
    rows: readonly E2eeRecordRow[],
    outbox: readonly E2eeOutboxRow[] = [],
  ): Promise<void> {
    return this.serial.run(async () => {
      const state = await this.e2eeStore();
      const byKey = new Map(state.records.map((r) => [`${r.groupId}:${r.id}`, r]));
      for (const r of rows) byKey.set(`${r.groupId}:${r.id}`, r);
      const ids = new Set(state.outbox.map((o) => o.id));
      await this.writeE2eeStore({
        ...state,
        records: [...byKey.values()],
        outbox: [...state.outbox, ...outbox.filter((o) => !ids.has(o.id))],
      });
    });
  }

  replaceE2eeGroup(groupId: string, rows: readonly E2eeRecordRow[]): Promise<void> {
    return this.serial.run(async () => {
      const state = await this.e2eeStore();
      const recs = state.records.filter((r) => r.groupId !== groupId);
      const out = state.outbox.filter((o) => o.groupId !== groupId);
      await this.writeE2eeStore({
        records: [...recs, ...rows],
        outbox: out,
        pending: state.pending.filter(([g]) => g !== groupId),
      });
    });
  }

  readE2eeRecords(): Promise<E2eeRecordRow[]> {
    return this.serial.run(async () => (await this.e2eeStore()).records);
  }

  readE2eePending(): Promise<[string, e2ee.PendingOp[]][]> {
    return this.serial.run(async () => (await this.e2eeStore()).pending);
  }

  writeE2eePending(groupId: string, rows: readonly e2ee.PendingOp[]): Promise<void> {
    return this.serial.run(async () => {
      const state = await this.e2eeStore();
      const next = state.pending.filter(([g]) => g !== groupId);
      if (rows.length > 0) next.push([groupId, [...rows]]);
      await this.writeE2eeStore({ ...state, pending: next });
    });
  }

  readE2eeOutbox(): Promise<E2eeOutboxRow[]> {
    return this.serial.run(async () => (await this.e2eeStore()).outbox);
  }

  deleteE2eeOutbox(ids: readonly string[]): Promise<void> {
    return this.serial.run(async () => {
      const gone = new Set(ids);
      const state = await this.e2eeStore();
      await this.writeE2eeStore({ ...state, outbox: state.outbox.filter((o) => !gone.has(o.id)) });
    });
  }

  updateE2eeOutbox(row: E2eeOutboxRow): Promise<void> {
    return this.serial.run(async () => {
      const state = await this.e2eeStore();
      await this.writeE2eeStore({
        ...state,
        outbox: state.outbox.map((item) => (item.id === row.id ? row : item)),
      });
    });
  }

  wipeE2ee(): Promise<void> {
    return this.serial.run(() =>
      AsyncStorage.removeMany([WEB_E2EE_KEY, ...Object.values(WEB_E2EE_LEGACY_KEYS)]),
    );
  }
}

export function createLocalStore(): LocalStore {
  return new AsyncStorageStore();
}
