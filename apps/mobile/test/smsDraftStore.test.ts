/**
 * The phone's SMS draft store: sealed at rest, bodiless for inbox drafts, and
 * gone at sign-out.
 *
 * `smsLocalDrafts.test.ts` covers the rules over a fake backend; this covers
 * the real one — what actually lands in the SQLite file. The row is the thing
 * a copied-off database file would show, so the assertions are about the raw
 * row, not the value the store hands back.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaptureRow } from '@/data/types';

const state = vi.hoisted(() => {
  class FakeDraftDatabase {
    rows: { owner_id: string; capture_id: string; sealed: string | null }[] = [];
    execs: string[] = [];

    reset(): void {
      this.rows = [];
      this.execs = [];
    }

    async execAsync(source: string): Promise<void> {
      this.execs.push(source.trim());
      if (source.includes('DROP TABLE IF EXISTS sms_drafts')) this.rows = [];
    }

    async runAsync(source: string, ...params: unknown[]): Promise<{ changes: number }> {
      if (/^\s*INSERT INTO sms_drafts/i.test(source)) {
        const [owner, id, sealed] = params as [string, string, string | null];
        const existing = this.rows.find((r) => r.owner_id === owner && r.capture_id === id);
        if (existing) existing.sealed = sealed;
        else this.rows.push({ owner_id: owner, capture_id: id, sealed });
        return { changes: 1 };
      }
      if (/DELETE FROM sms_drafts WHERE owner_id = \? AND capture_id = \?/i.test(source)) {
        const [owner, id] = params as [string, string];
        const before = this.rows.length;
        this.rows = this.rows.filter((r) => !(r.owner_id === owner && r.capture_id === id));
        return { changes: before - this.rows.length };
      }
      if (/DELETE FROM sms_drafts WHERE owner_id = \?/i.test(source)) {
        const before = this.rows.length;
        this.rows = this.rows.filter((r) => r.owner_id !== params[0]);
        return { changes: before - this.rows.length };
      }
      return { changes: 0 };
    }

    async getAllAsync(_source: string, owner: string): Promise<unknown[]> {
      return this.rows.filter((r) => r.owner_id === owner);
    }
  }
  return { database: new FakeDraftDatabase() };
});

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => state.database }));

// A stand-in seal: opaque (the plaintext is base64-wrapped, so a
// substring search of the stored value cannot find it) and bound to its row.
vi.mock('@/sync/rowCipher', () => ({
  encryptWith: (_key: unknown, plain: string, aad: string) =>
    `sealed[${aad}]${Buffer.from(plain).toString('base64')}`,
  decryptWith: (_key: unknown, sealed: string, aad: string) => {
    const prefix = `sealed[${aad}]`;
    if (!sealed.startsWith(prefix)) throw new Error('authentication failed');
    return Buffer.from(sealed.slice(prefix.length), 'base64').toString();
  },
  loadKey: async () => new Uint8Array(32),
}));

const { smsDrafts, forgetSmsDraftsForOwner } = await import('@/lib/smsDraftStore');

const OWNER = 'owner-1';
const BODY = 'Rs.450.00 debited from a/c XX1234 at SWIGGY. Avl bal Rs.12,000';

function draft(id: string, over: Partial<CaptureRow> = {}): CaptureRow {
  return {
    id,
    owner_user_id: OWNER,
    description: 'SWIGGY',
    category: 'food',
    category_meta: null,
    expense_date: '2026-03-10',
    currency: 'INR',
    amount: '45000',
    notes: null,
    photo_path: null,
    raw_text: null,
    parsed: { source: 'sms', channel: 'inbox', sender: 'AX-HDFCBK', accountTail: '1234' },
    payment_method: null,
    target_group_id: null,
    location: null,
    status: 'open' as CaptureRow['status'],
    assigned_expense_id: null,
    assigned_group_id: null,
    created_at: '2026-03-10T09:00:00.000Z',
    ...over,
  };
}

beforeEach(async () => {
  await smsDrafts.forgetEverything();
  state.database.reset();
});

describe('smsDraftStore', () => {
  it('seals the whole draft: no fact and no body is readable in the stored row', async () => {
    await smsDrafts.put(OWNER, draft('c1'));

    expect(state.database.rows).toHaveLength(1);
    const stored = state.database.rows[0]!;
    expect(stored.owner_id).toBe(OWNER);
    expect(stored.capture_id).toBe('c1');
    const raw = JSON.stringify(stored);
    for (const fact of ['SWIGGY', '45000', 'AX-HDFCBK', '1234', '2026-03-10', BODY]) {
      expect(raw).not.toContain(fact);
    }
    expect(stored.sealed?.startsWith('sealed[sms_drafts')).toBe(true);
  });

  it('an inbox draft carries no message body, even sealed', async () => {
    await smsDrafts.put(OWNER, draft('c1'));

    // Open the seal the way the store does and look inside.
    const sealed = state.database.rows[0]!.sealed!;
    const inside = Buffer.from(sealed.slice(sealed.indexOf(']') + 1), 'base64').toString();
    expect(inside).not.toContain('debited');
    expect(JSON.parse(inside).row.raw_text).toBeNull();
  });

  it('reads back what it sealed, bound to the row it was written for', async () => {
    await smsDrafts.put(OWNER, draft('c1'));
    await smsDrafts.refresh(OWNER);

    expect(smsDrafts.openDrafts(OWNER).map((row) => [row.id, row.local])).toEqual([['c1', true]]);
  });

  it('a draft that will not open is deleted, not tombstoned, so a rescan can re-propose it', async () => {
    await smsDrafts.put(OWNER, draft('c1'));
    // A row copied under another id fails its seal — as every row would if
    // the key were lost.
    state.database.rows.push({ ...state.database.rows[0]!, capture_id: 'c2' });

    await smsDrafts.refresh(OWNER);

    // Gone from disk…
    expect(state.database.rows.map((r) => r.capture_id)).toEqual(['c1']);
    // …and not "handled": the reader is free to draft that message again.
    expect(await smsDrafts.handledIds(OWNER)).toEqual(new Set(['c1']));
    expect(await smsDrafts.put(OWNER, draft('c2'))).toBe(true);
  });

  it('a dismissed draft leaves a tombstone with nothing in it', async () => {
    await smsDrafts.put(OWNER, draft('c1'));
    await smsDrafts.remove(OWNER, 'c1');

    expect(state.database.rows).toEqual([{ owner_id: OWNER, capture_id: 'c1', sealed: null }]);
    expect(await smsDrafts.put(OWNER, draft('c1'))).toBe(false);
  });

  it('the sign-out step removes this account’s drafts and tombstones, and only them', async () => {
    await smsDrafts.put(OWNER, draft('c1'));
    await smsDrafts.remove(OWNER, 'c1');
    await smsDrafts.put(OWNER, draft('c2'));
    await smsDrafts.put('other', draft('c3', { owner_user_id: 'other' }));

    await forgetSmsDraftsForOwner(OWNER);

    expect(state.database.rows.map((r) => [r.owner_id, r.capture_id])).toEqual([['other', 'c3']]);
    expect(smsDrafts.openDrafts(OWNER)).toEqual([]);
    expect(state.database.execs).toContain('PRAGMA wal_checkpoint(TRUNCATE)');
  });
});
