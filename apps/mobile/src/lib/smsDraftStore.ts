/**
 * This phone's SMS drafts, sealed, in a file nothing syncs.
 *
 * The same promise `smsMessageStore.ts` makes about message bodies, made about
 * the drafts built from them: what a bank message said — the amount, the shop,
 * the day, the sender, the card's last digits — stays on the device that read
 * it until the person turns it into an expense. `lib/smsLocalDrafts.ts` says
 * why; this is where the drafts actually live.
 *
 *   * **Its own database file.** The sync engine opens `waves.db` and reads two
 *     tables in it. This is `waves-sms-drafts.db`, which it never opens, so no
 *     code path — correct or buggy — can put a row here onto the queue.
 *   * **Sealed at rest, whole.** Every column but the account and the capture
 *     id is one ciphertext, sealed with the mirror's key (`sync/rowCipher`)
 *     and bound to its own (account, id). Nothing about the draft is in the
 *     clear, not even its date. A copy of the file without the Keystore entry
 *     is noise.
 *   * **Tombstones say nothing.** A used or dismissed draft keeps its row with
 *     a null payload, so the reader does not propose the message again. The id
 *     is `smsCaptureId` — a SHA-256 of the account and the message's dedupe
 *     key — which is not reversible into anything.
 *   * **Wiped at sign-out** (`sync/localWipe.ts`), with the WAL checkpointed so
 *     the bytes go too.
 *   * **Never in the personal cloud backup.** `lib/backup` carries only
 *     `personal_records` rows; nothing here is read by it, and Android Auto
 *     Backup is off for the whole app (`app.json`, `allowBackup: false`).
 *
 * And, as everywhere on the SMS path, nothing is reported to Sentry, Clarity
 * or analytics from this file: the catches are silent on purpose.
 */

import * as SQLite from 'expo-sqlite';

import type { CaptureRow } from '@/data/types';
import { decryptWith, encryptWith, loadKey, type MirrorKey } from '@/sync/rowCipher';

import { createDraftCache, type DraftBackend, type DraftEntry } from './smsDraftCache';

export type { DraftEntry } from './smsDraftCache';

const DATABASE_NAME = 'waves-sms-drafts.db';

const AAD_SEP = '\x1f';
export const draftAad = (ownerId: string, captureId: string): string =>
  ['sms_drafts', ownerId, captureId].join(AAD_SEP);

const SCHEMA = `
PRAGMA busy_timeout = 5000;
PRAGMA secure_delete = ON;
PRAGMA journal_mode = WAL;

-- One row per draft (or tombstone) per account. "sealed" is the whole draft,
-- one ciphertext; NULL means the draft was used or dismissed.
CREATE TABLE IF NOT EXISTS sms_drafts (
  owner_id   TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  sealed     TEXT,
  PRIMARY KEY (owner_id, capture_id)
);
`;

let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/** Opened once; a failed open is not remembered (see `smsMessageStore.db`). */
async function db(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  opening ??= (async () => {
    const opened = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await opened.execAsync(SCHEMA);
    database = opened;
    return opened;
  })();
  try {
    return await opening;
  } catch (error) {
    opening = null;
    throw error;
  }
}

let key: MirrorKey | null = null;
async function cipherKey(): Promise<MirrorKey> {
  key ??= await loadKey();
  return key;
}

/** What is sealed: the row and the hold, nothing else. */
export function sealEntry(sealingKey: MirrorKey, ownerId: string, entry: DraftEntry): string {
  return encryptWith(
    sealingKey,
    JSON.stringify({ row: entry.row, held: entry.held, filed: entry.filed === true }),
    draftAad(ownerId, entry.row.id),
  );
}

function openEntry(
  sealingKey: MirrorKey,
  ownerId: string,
  captureId: string,
  sealed: string,
): DraftEntry | null {
  const parsed = JSON.parse(decryptWith(sealingKey, sealed, draftAad(ownerId, captureId))) as {
    row: CaptureRow;
    held: DraftEntry['held'];
    filed?: boolean;
  };
  if (!parsed?.row || parsed.row.id !== captureId) throw new Error('draft row mismatch');
  return {
    row: { ...parsed.row, local: true },
    held: parsed.held ?? null,
    filed: parsed.filed === true,
  };
}

const sqliteBackend: DraftBackend = {
  async load(ownerId) {
    const sealingKey = await cipherKey();
    const connection = await db();
    const rows = await connection.getAllAsync<{ capture_id: string; sealed: string | null }>(
      `SELECT capture_id, sealed FROM sms_drafts WHERE owner_id = ?`,
      ownerId,
    );
    const map = new Map<string, DraftEntry | null>();
    const unreadable: string[] = [];
    for (const row of rows) {
      if (row.sealed === null) {
        map.set(row.capture_id, null);
        continue;
      }
      try {
        map.set(row.capture_id, openEntry(sealingKey, ownerId, row.capture_id, row.sealed));
      } catch {
        unreadable.push(row.capture_id);
      }
    }
    // A draft that will not open — the key was lost (a reinstall, a Keystore
    // reset), or the row is damaged — is deleted and left out, not turned into
    // a tombstone. A tombstone would block the reader from ever proposing that
    // message again; deleted, the next scan re-drafts it from the phone's
    // inbox, which still has it. A pasted draft is simply gone, as its
    // ciphertext already was.
    for (const captureId of unreadable) {
      await connection.runAsync(
        `DELETE FROM sms_drafts WHERE owner_id = ? AND capture_id = ?`,
        ownerId,
        captureId,
      );
    }
    return map;
  },

  async write(ownerId, captureId, entry) {
    const sealed = entry === null ? null : sealEntry(await cipherKey(), ownerId, entry);
    const connection = await db();
    await connection.runAsync(
      `INSERT INTO sms_drafts (owner_id, capture_id, sealed) VALUES (?, ?, ?)
       ON CONFLICT (owner_id, capture_id) DO UPDATE SET sealed = excluded.sealed`,
      ownerId,
      captureId,
      sealed,
    );
  },

  async forgetOwner(ownerId) {
    const connection = await db();
    await connection.runAsync(`DELETE FROM sms_drafts WHERE owner_id = ?`, ownerId);
    // The write-ahead log holds page images from before the delete, and
    // `secure_delete` does not reach it.
    await connection.execAsync(`PRAGMA wal_checkpoint(TRUNCATE)`);
    // The mirror's key is destroyed by the same sign-out; the next account
    // mints a new one, so the cached copy must not outlive this.
    key = null;
  },

  async forgetEverything() {
    const connection = await db();
    await connection.execAsync(`DROP TABLE IF EXISTS sms_drafts;`);
    await connection.execAsync(SCHEMA);
    await connection.execAsync(`PRAGMA wal_checkpoint(TRUNCATE)`);
    key = null;
  },
};

/** The one cache over this device's drafts. */
export const smsDrafts = createDraftCache(sqliteBackend);

/** The sign-out step: this account's drafts and tombstones, off the phone. */
export function forgetSmsDraftsForOwner(ownerId: string): Promise<void> {
  return smsDrafts.forgetOwner(ownerId);
}
