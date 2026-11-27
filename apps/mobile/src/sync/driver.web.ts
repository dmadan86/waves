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

/** The couple e2ee tables. Kept out of WEB_KEYS: `reset` removes every WEB_KEYS entry. */
const WEB_E2EE_KEYS = { records: 'waves:e2ee:records', outbox: 'waves:e2ee:outbox' } as const;

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
      if (rows.length > 0) {
        const byKey = new Map(
          (await this.readJson<E2eeRecordRow[]>(WEB_E2EE_KEYS.records, [])).map((r) => [
            `${r.groupId}:${r.id}`,
            r,
          ]),
        );
        for (const r of rows) byKey.set(`${r.groupId}:${r.id}`, r);
        await AsyncStorage.setItem(WEB_E2EE_KEYS.records, e2ee.encodeJson([...byKey.values()]));
      }
      if (outbox.length > 0) {
        const held = await this.readJson<E2eeOutboxRow[]>(WEB_E2EE_KEYS.outbox, []);
        const ids = new Set(held.map((o) => o.id));
        await AsyncStorage.setItem(
          WEB_E2EE_KEYS.outbox,
          e2ee.encodeJson([...held, ...outbox.filter((o) => !ids.has(o.id))]),
        );
      }
    });
  }

  readE2eeRecords(): Promise<E2eeRecordRow[]> {
    return this.serial.run(() => this.readJson<E2eeRecordRow[]>(WEB_E2EE_KEYS.records, []));
  }

  readE2eeOutbox(): Promise<E2eeOutboxRow[]> {
    return this.serial.run(() => this.readJson<E2eeOutboxRow[]>(WEB_E2EE_KEYS.outbox, []));
  }

  deleteE2eeOutbox(ids: readonly string[]): Promise<void> {
    return this.serial.run(async () => {
      const gone = new Set(ids);
      const held = await this.readJson<E2eeOutboxRow[]>(WEB_E2EE_KEYS.outbox, []);
      await AsyncStorage.setItem(
        WEB_E2EE_KEYS.outbox,
        e2ee.encodeJson(held.filter((o) => !gone.has(o.id))),
      );
    });
  }

  wipeE2ee(): Promise<void> {
    return this.serial.run(() => AsyncStorage.removeMany(Object.values(WEB_E2EE_KEYS)));
  }
}

export function createLocalStore(): LocalStore {
  return new AsyncStorageStore();
}
