/**
 * The durable half of the offline client (ADR-005).
 *
 * ADR-005 asks for a SQLite mirror of the user's groups, a mutation queue that
 * survives a forced kill, and drafts that autosave on every keystroke. That is
 * exactly what this file provides — and nothing else: no decisions about what
 * to sync or when, which live in `engine.ts` and, for the rules worth
 * property-testing, in @waves/core.
 *
 * There are two implementations behind one interface. Native gets real SQLite.
 * Web gets an AsyncStorage-backed store, because expo-sqlite's web build needs
 * cross-origin isolation headers that the dev server and a plain static export
 * do not send — and a guest opening an invite link (ADR-006) should not meet a
 * blank screen because of it. Both are exercised by the same engine.
 */

import type { MirrorRow, QueuedMutation, SyncTable } from '@waves/core';

import type { RetainedWork } from './retention';

export interface StoredRow {
  table: SyncTable;
  id: string;
  groupId: string;
  seq: number;
  row: MirrorRow;
}

export interface LocalStore {
  ready(): Promise<void>;
  putRows(rows: readonly StoredRow[]): Promise<void>;
  readRows(): Promise<StoredRow[]>;
  readCursors(): Promise<Record<string, number>>;
  writeCursors(cursors: Record<string, number>): Promise<void>;
  readQueue(): Promise<QueuedMutation[]>;
  writeQueue(queue: readonly QueuedMutation[]): Promise<void>;
  readDraft<T>(key: string): Promise<T | null>;
  writeDraft(key: string, value: unknown): Promise<void>;
  clearDraft(key: string): Promise<void>;
  listDrafts(): Promise<{ key: string; value: unknown; savedAt: string }[]>;
  /**
   * Drop every mirror row and cursor for one group, and replace the queue with
   * `queue` (the group's still-unsent edits removed), as one durable step.
   * Leaving a group hides it server-side (RLS), so a pull can never again report
   * it — the client has to forget it locally or it lingers on the dashboard
   * forever, and a half-applied purge would leave the queue replaying against a
   * group the mirror no longer has.
   */
  forgetGroup(groupId: string, queue: readonly QueuedMutation[]): Promise<void>;
  /** Signing out must leave nothing of the previous account behind. */
  reset(): Promise<void>;
  /**
   * A session that ended without anybody asking for it (see `retention.ts`).
   *
   * Drops the mirror and the cursors — the server's copy of the ledger, which
   * it will hand back on the next sign-in — and keeps the queue, the drafts and
   * the encryption key that opens them, because nothing else holds those. The
   * owner is stamped in the same transaction: work that cannot say whose it is
   * can never be adopted, so writing the stamp and clearing the mirror have to
   * commit together or not at all.
   */
  retainUnsent(ownerId: string, retainedAt: string): Promise<void>;
  /** Whose the retained work is, or null when nothing is being held. */
  readRetained(): Promise<RetainedWork | null>;
  /** Adopted: the same account came back, and the queue is theirs again. */
  clearRetained(): Promise<void>;
}

/**
 * Resolved by Metro per platform: `driver.web.ts` on web, `driver.ts` on
 * native. The split is not stylistic — a static `expo-sqlite` import pulls its
 * WASM build into the web bundle even behind a `Platform.OS` check, and that
 * build needs cross-origin isolation headers a static export cannot send.
 */
export { createLocalStore } from './driver';
