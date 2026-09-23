/**
 * Bank messages are local, but local does not mean global to the phone.
 *
 * A shared device can hold a user, rider, traveller and financer one after
 * another. Clearing retained work for one account must not wipe another
 * account's inbox: the table key is `(owner_id, dedupe_key)` and cleanup has to
 * respect the same boundary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SmsKind } from '@waves/core';

import type { IncomingSms } from '@/lib/smsMessageTypes';

const state = vi.hoisted(() => {
  class FakeSmsDatabase {
    readonly execs: string[] = [];
    readonly deletedOwners: string[] = [];
    /**
     * The table's rows. The first tests set only the primary key a delete
     * filters on; the row tests below go through the store's own INSERT.
     */
    rows: ({ owner_id: string; dedupe_key: string } & Record<string, unknown>)[] = [];
    dropped = false;

    reset(): void {
      this.execs.length = 0;
      this.deletedOwners.length = 0;
      this.rows = [];
      this.dropped = false;
    }

    async execAsync(source: string): Promise<void> {
      this.execs.push(source.trim());
      if (source.includes('DROP TABLE IF EXISTS sms_messages')) {
        this.dropped = true;
        this.rows = [];
      }
    }

    async runAsync(source: string, ...params: unknown[]): Promise<{ changes: number }> {
      if (/DELETE FROM sms_messages WHERE owner_id = \? AND dedupe_key = \?/i.test(source)) {
        const [owner, key] = params as [string, string];
        const before = this.rows.length;
        this.rows = this.rows.filter((r) => !(r.owner_id === owner && r.dedupe_key === key));
        return { changes: before - this.rows.length };
      }
      if (/DELETE FROM sms_messages WHERE owner_id = \?/i.test(source)) {
        const owner = params[0] as string;
        this.deletedOwners.push(owner);
        const before = this.rows.length;
        this.rows = this.rows.filter((row) => row.owner_id !== owner);
        return { changes: before - this.rows.length };
      }
      if (/^\s*INSERT INTO sms_messages/i.test(source)) {
        const columns = [
          'owner_id',
          'dedupe_key',
          'body',
          'sender',
          'kind',
          'reason',
          'merchant',
          'account_tail',
          'currency',
          'amount',
          'occurred_on',
          'at',
          'confidence',
          'date_inferred',
          'read_at',
        ];
        const row = Object.fromEntries(columns.map((c, i) => [c, params[i]])) as {
          owner_id: string;
          dedupe_key: string;
        } & Record<string, unknown>;
        if (this.find(row.owner_id, row.dedupe_key)) return { changes: 0 };
        this.rows.push({ ...row, settled_as: null, capture_id: null });
        return { changes: 1 };
      }
      if (/^\s*UPDATE sms_messages SET settled_as = \?, capture_id = \?/i.test(source)) {
        const [settledAs, captureId, owner, key] = params as [
          string,
          string | null,
          string,
          string,
        ];
        const row = this.find(owner, key);
        if (!row) return { changes: 0 };
        Object.assign(row, { settled_as: settledAs, capture_id: captureId });
        return { changes: 1 };
      }
      if (/^\s*UPDATE sms_messages SET settled_as = NULL/i.test(source)) {
        const [owner, key] = params as [string, string];
        const row = this.find(owner, key);
        if (!row) return { changes: 0 };
        Object.assign(row, { settled_as: null, capture_id: null });
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    find(owner: string, key: string) {
      return this.rows.find((r) => r.owner_id === owner && r.dedupe_key === key);
    }

    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      await task();
    }

    async getAllAsync(source: string, owner?: string): Promise<unknown[]> {
      const mine = this.rows.filter((r) => r.owner_id === owner);
      if (/SELECT dedupe_key FROM/i.test(source)) {
        return mine.map((r) => ({ dedupe_key: r.dedupe_key }));
      }
      return [...mine].sort((a, b) =>
        `${b.occurred_on}${b.at}`.localeCompare(`${a.occurred_on}${a.at}`),
      );
    }
  }

  return {
    database: new FakeSmsDatabase(),
    opens: 0,
    keys: 0,
    failNextOpen: false,
  };
});

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    state.opens += 1;
    if (state.failNextOpen) {
      state.failNextOpen = false;
      throw new Error('database is locked');
    }
    return state.database;
  },
}));

// A stand-in seal that is bound to its row identity the way the real one is:
// opening a body under any other (owner, key) fails.
vi.mock('@/sync/rowCipher', () => ({
  encryptWith: (_key: unknown, plain: string, aad: string) => `sealed[${aad}]${plain}`,
  decryptWith: (_key: unknown, sealed: string, aad: string) => {
    const prefix = `sealed[${aad}]`;
    if (!sealed.startsWith(prefix)) throw new Error('authentication failed');
    return sealed.slice(prefix.length);
  },
  loadKey: async () => {
    state.keys += 1;
    return { bytes: new Uint8Array(32) };
  },
}));

const store = await import('@/lib/smsMessageStore');

beforeEach(() => {
  state.database.reset();
  state.opens = 0;
  state.keys = 0;
});

describe('forgetMessagesForOwner', () => {
  it('deletes only the user, rider, traveller or financer being cleared', async () => {
    await store.forgetMessagesForOwner('traveller');

    expect(state.database.deletedOwners).toEqual(['traveller']);
    expect(state.database.dropped).toBe(false);
    expect(state.database.execs).toContain('PRAGMA wal_checkpoint(TRUNCATE)');
  });

  it('removes that owner’s rows and leaves every other account’s on the phone', async () => {
    state.database.rows = [
      { owner_id: 'rider', dedupe_key: 'k1' },
      { owner_id: 'traveller', dedupe_key: 'k1' },
      { owner_id: 'traveller', dedupe_key: 'k2' },
      { owner_id: 'financer', dedupe_key: 'k3' },
    ];

    await store.forgetMessagesForOwner('traveller');

    expect(state.database.rows).toEqual([
      { owner_id: 'rider', dedupe_key: 'k1' },
      { owner_id: 'financer', dedupe_key: 'k3' },
    ]);
  });

  it('does nothing when there is no owner to clear', async () => {
    await store.forgetMessagesForOwner('');

    expect(state.opens).toBe(0);
    expect(state.database.deletedOwners).toEqual([]);
  });
});

describe('forgetEverything', () => {
  it('keeps the deliberate whole-store sign-out cleanup and checkpoints the WAL', async () => {
    await store.forgetEverything();

    expect(state.database.dropped).toBe(true);
    expect(state.database.deletedOwners).toEqual([]);
    expect(state.database.execs).toContain('PRAGMA wal_checkpoint(TRUNCATE)');
  });
});

function incoming(over: Partial<IncomingSms> = {}): IncomingSms {
  return {
    dedupeKey: 'ref-1',
    body: 'Rs 450.00 debited at SWIGGY',
    sender: 'AX-HDFCBK',
    kind: SmsKind.Expense,
    reason: null,
    merchant: 'SWIGGY',
    accountTail: '1234',
    currency: 'INR',
    amount: '45000',
    occurredOn: '2026-03-10',
    at: '2026-03-10T09:00:00.000Z',
    confidence: 0.9,
    dateInferred: false,
    ...over,
  };
}

describe('saving and reading messages', () => {
  it('seals the body at rest and hands it back opened, with the facts beside it', async () => {
    expect(await store.saveMessages('alice', [incoming()])).toBe(1);

    expect(state.database.rows[0]!.body).not.toBe('Rs 450.00 debited at SWIGGY');
    expect(state.database.rows[0]!.date_inferred).toBe(0);

    const [row] = await store.loadMessages('alice');
    expect(row).toMatchObject({
      dedupeKey: 'ref-1',
      body: 'Rs 450.00 debited at SWIGGY',
      kind: SmsKind.Expense,
      reason: null,
      dateInferred: false,
      settledAs: null,
      captureId: null,
    });
    expect(typeof row!.readAt).toBe('string');
  });

  it('counts only rows that were actually new — a re-scan of the same ground adds nothing', async () => {
    await store.saveMessages('alice', [incoming()]);

    const added = await store.saveMessages('alice', [
      incoming(),
      incoming({ dedupeKey: 'ref-2', dateInferred: true }),
    ]);

    expect(added).toBe(1);
    expect(state.database.rows).toHaveLength(2);
  });

  it('writes nothing for no account or no messages', async () => {
    expect(await store.saveMessages('', [incoming()])).toBe(0);
    expect(await store.saveMessages('alice', [])).toBe(0);
    expect(state.opens).toBe(0);
  });

  it('returns a row whose body will not open with an empty body instead of losing the screen', async () => {
    await store.saveMessages('alice', [incoming()]);
    state.database.rows[0]!.body = 'truncated ciphertext';

    const [row] = await store.loadMessages('alice');

    expect(row).toMatchObject({ dedupeKey: 'ref-1', body: '', merchant: 'SWIGGY' });
  });

  it('never shows one account another account’s messages', async () => {
    await store.saveMessages('alice', [incoming()]);
    await store.saveMessages('bob', [incoming({ dedupeKey: 'ref-9' })]);

    expect((await store.loadMessages('bob')).map((r) => r.dedupeKey)).toEqual(['ref-9']);
    expect(await store.knownKeys('alice')).toEqual(new Set(['ref-1']));
    expect(await store.loadMessages('')).toEqual([]);
    expect(await store.knownKeys('')).toEqual(new Set());
  });

  it('lists the newest spend first', async () => {
    await store.saveMessages('alice', [
      incoming({ dedupeKey: 'old', occurredOn: '2026-03-01' }),
      incoming({ dedupeKey: 'new', occurredOn: '2026-03-09' }),
    ]);

    expect((await store.loadMessages('alice')).map((r) => r.dedupeKey)).toEqual(['new', 'old']);
  });
});

describe('answering messages', () => {
  it('marks several placed in one go, each with the draft it became', async () => {
    await store.saveMessages('alice', [incoming(), incoming({ dedupeKey: 'ref-2' })]);

    await store.settleMessages(
      'alice',
      ['ref-1', 'ref-2'],
      store.SmsSettlement.Placed,
      (key) => `cap-${key}`,
    );

    const rows = await store.loadMessages('alice');
    expect(rows.map((r) => [r.dedupeKey, r.settledAs, r.captureId])).toEqual(
      expect.arrayContaining([
        ['ref-1', 'placed', 'cap-ref-1'],
        ['ref-2', 'placed', 'cap-ref-2'],
      ]),
    );
  });

  it('dismisses without a draft, and the undo puts it back to waiting', async () => {
    await store.saveMessages('alice', [incoming()]);

    await store.settleMessages('alice', ['ref-1'], store.SmsSettlement.Dismissed);
    expect((await store.loadMessages('alice'))[0]).toMatchObject({
      settledAs: 'dismissed',
      captureId: null,
    });

    await store.unsettleMessage('alice', 'ref-1');
    expect((await store.loadMessages('alice'))[0]!.settledAs).toBeNull();
  });

  it('touches nothing without an account or keys', async () => {
    await store.settleMessages('', ['ref-1'], store.SmsSettlement.Placed);
    await store.settleMessages('alice', [], store.SmsSettlement.Placed);
    await store.unsettleMessage('', 'ref-1');
    await store.forgetMessage('', 'ref-1');
    expect(state.opens).toBe(0);
  });

  it('forgets one message for good and leaves the rest', async () => {
    await store.saveMessages('alice', [incoming(), incoming({ dedupeKey: 'ref-2' })]);

    await store.forgetMessage('alice', 'ref-1');

    expect(await store.knownKeys('alice')).toEqual(new Set(['ref-2']));
  });
});

describe('the connection and the key', () => {
  it('opens the database once and does not remember a failed open', async () => {
    vi.resetModules();
    state.failNextOpen = true;
    const fresh = await import('@/lib/smsMessageStore');

    await expect(fresh.knownKeys('alice')).rejects.toThrow('database is locked');
    await expect(fresh.knownKeys('alice')).resolves.toEqual(new Set());
    await fresh.knownKeys('alice');

    expect(state.opens).toBe(2);
  });

  it('reloads the sealing key after a sign-out wipe', async () => {
    vi.resetModules();
    const fresh = await import('@/lib/smsMessageStore');
    await fresh.saveMessages('alice', [incoming()]);
    await fresh.saveMessages('alice', [incoming({ dedupeKey: 'ref-2' })]);
    expect(state.keys).toBe(1);

    await fresh.forgetEverything();
    await fresh.loadMessages('alice');

    expect(state.keys).toBe(2);
    expect(state.database.rows).toEqual([]);
  });
});

// Proves the test still imports the same enum shape as the native store contract.
expect(SmsKind.Expense).toBe('expense');
