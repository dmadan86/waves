/**
 * The couple space as this phone holds it: every record's merge state (hlcs and
 * tombstones included), per group, in memory and in `e2ee_records`.
 *
 * Pure of React Native: the store is passed in, so tests drive two phones with
 * nothing but a fake mailbox between them.
 */

import { e2ee } from '@waves/core';

import type { E2eeOutboxRow, E2eeRecordRow } from '@/sync/store';

type Store = e2ee.Store;

/** What the rentals screens read: the same shape as a personal ledger row. */
export interface GroupRecord {
  readonly id: string;
  readonly group_id: string;
  readonly record_kind: string;
  readonly data: Record<string, unknown>;
  /** Member id of whoever first wrote it. */
  readonly created_by: string;
  readonly created_at: string;
  readonly deleted_at: null;
  readonly pending: boolean;
}

export interface Me {
  readonly memberId: string;
  /** This phone's hlc id (see `clockId`). */
  readonly clockId: string;
}

/** What waits in `e2ee_outbox`: the message to seal for each recipient, and the push hint. */
export interface OutboxMsg {
  readonly plaintext: e2ee.Plaintext;
  readonly hint: string | null;
}

export interface SpaceIo {
  readE2eeRecords(): Promise<E2eeRecordRow[]>;
  writeE2eeRecords(
    rows: readonly E2eeRecordRow[],
    outbox?: readonly E2eeOutboxRow[],
  ): Promise<void>;
}

export interface Incoming {
  readonly groupId: string;
  readonly ops: readonly e2ee.MergeOp[];
  readonly senderMemberId: string;
}

const same = (a: unknown, b: unknown): boolean => e2ee.encodeJson(a) === e2ee.encodeJson(b);

/** The fields of a record that are newer than its delete. */
function aliveFields(rec: e2ee.RecordState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, [v, h]] of Object.entries(rec.fields))
    if (rec.deleted === undefined || e2ee.compareHlc(h, rec.deleted) > 0) out[k] = v;
  return out;
}

/** The latest stamp this group has seen, so the next local stamp is later than all of them. */
function lastHlc(store: Store): string | null {
  let last: string | null = null;
  const see = (h: string | undefined): void => {
    if (h !== undefined && (last === null || e2ee.compareHlc(h, last) > 0)) last = h;
  };
  for (const rec of Object.values(store)) {
    see(rec.deleted);
    for (const f of Object.values(rec.fields)) see(f[1]);
  }
  return last;
}

export class E2eeSpace {
  private stores = new Map<string, Store>();
  private listeners = new Set<() => void>();
  private cache = new Map<string, { store: Store; list: readonly GroupRecord[] }>();
  private chain: Promise<unknown> = Promise.resolve();
  /** Called after a message lands in the outbox, so the mailbox can send it. */
  onOutbox: (() => void) | null = null;

  constructor(
    private readonly io: SpaceIo,
    // No default: Hermes has no Web Crypto, so the phone passes expo-crypto ids.
    private readonly clock: { now: () => number; newId: () => string },
  ) {}

  async load(): Promise<void> {
    const rows = await this.io.readE2eeRecords();
    const stores = new Map<string, Record<string, e2ee.RecordState>>();
    for (const r of rows) {
      const s = stores.get(r.groupId) ?? {};
      s[r.id] = r.state;
      stores.set(r.groupId, s);
    }
    this.stores = stores;
    this.notify();
  }

  /** Sign-out: the tables are wiped by the store; this drops what is in memory. */
  clear(): void {
    this.stores = new Map();
    this.cache.clear();
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Bumps on every change, so a hook can key a memo on it. */
  version = 0;

  private notify(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  groupIds(): string[] {
    return [...this.stores.keys()];
  }

  /** Live records of one group. The same array until that group changes. */
  records(groupId: string): readonly GroupRecord[] {
    const store = this.stores.get(groupId);
    if (!store) return NONE;
    const hit = this.cache.get(groupId);
    if (hit && hit.store === store) return hit.list;
    const list: GroupRecord[] = [];
    for (const id of Object.keys(store).sort()) {
      const rec = store[id]!;
      if (rec.createdBy === '') continue;
      const data = aliveFields(rec);
      if (Object.keys(data).length === 0) continue;
      list.push({
        id,
        group_id: groupId,
        record_kind: rec.kind,
        data,
        created_by: rec.createdBy,
        created_at: '',
        deleted_at: null,
        pending: false,
      });
    }
    this.cache.set(groupId, { store, list });
    return list;
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Commit new state for some records of one group, and optionally one outbox message. */
  private async commit(
    groupId: string,
    next: Store,
    touched: readonly string[],
    outbox: readonly E2eeOutboxRow[],
  ): Promise<void> {
    const rows = touched.map((id) => ({
      groupId,
      id,
      kind: next[id]!.kind,
      state: next[id]!,
    }));
    await this.io.writeE2eeRecords(rows, outbox);
    this.stores.set(groupId, next);
    this.notify();
  }

  /**
   * Create or edit one record, locally first. Only fields that changed are written, each
   * stamped now, so two partners editing different fields both keep their edit.
   */
  upsert(
    groupId: string,
    me: Me,
    id: string,
    kind: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    return this.run(async () => {
      const store = this.stores.get(groupId) ?? {};
      const cur = store[id];
      const known = cur && cur.createdBy !== '' ? cur : undefined;
      if (known && known.kind !== kind) throw new Error('e2ee: a record cannot change kind');
      const alive = known ? aliveFields(known) : {};
      const hlc = e2ee.tick(lastHlc(store), this.clock.now(), me.clockId);
      const fields: Record<string, e2ee.Field> = {};
      for (const [k, v] of Object.entries(data))
        if (!(k in alive) || !same(alive[k], v)) fields[k] = [v, hlc];
      // A key the new data no longer has (an address cleared) becomes null.
      for (const k of Object.keys(alive))
        if (!(k in data) && alive[k] !== null) fields[k] = [null, hlc];
      if (known && Object.keys(fields).length === 0) return;
      const op: e2ee.PutOp = {
        op: 'put',
        id,
        kind,
        createdBy: known?.createdBy ?? me.memberId,
        fields,
      };
      const rent =
        !known && kind === 'txn' && data.kind === 'income' && data.category === 'inc.rent';
      await this.send(groupId, me, store, [op], [id], rent ? 'rent_recorded' : null);
    });
  }

  /** Delete one record, locally first. A tombstone, so a late edit cannot bring it back. */
  del(groupId: string, me: Me, id: string): Promise<void> {
    return this.run(async () => {
      const store = this.stores.get(groupId) ?? {};
      const rec = store[id];
      if (!rec || rec.createdBy === '') return;
      const hlc = e2ee.tick(lastHlc(store), this.clock.now(), me.clockId);
      await this.send(groupId, me, store, [{ op: 'del', id, hlc }], [id], null);
    });
  }

  private async send(
    groupId: string,
    me: Me,
    store: Store,
    ops: e2ee.MergeOp[],
    touched: string[],
    hint: string | null,
  ): Promise<void> {
    const next = e2ee.applyOps(store, ops, me.memberId);
    const msgId = this.clock.newId();
    const msg: OutboxMsg = { plaintext: { v: 1, msgId, ops }, hint };
    await this.commit(groupId, next, touched, [
      {
        id: msgId,
        groupId,
        msg,
        createdAt: new Date(this.clock.now()).toISOString(),
      },
    ]);
    this.onOutbox?.();
  }

  /** Ops from the partner (or my other phone): merged and saved in one write. */
  applyIncoming(entries: readonly Incoming[]): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    return this.run(async () => {
      const byGroup = new Map<string, { next: Store; touched: Set<string> }>();
      for (const e of entries) {
        const g = byGroup.get(e.groupId) ?? {
          next: this.stores.get(e.groupId) ?? {},
          touched: new Set<string>(),
        };
        g.next = e2ee.applyOps(g.next, e.ops, e.senderMemberId);
        for (const op of e.ops) g.touched.add(op.id);
        byGroup.set(e.groupId, g);
      }
      const rows: E2eeRecordRow[] = [];
      for (const [groupId, g] of byGroup)
        for (const id of g.touched)
          if (g.next[id]) rows.push({ groupId, id, kind: g.next[id]!.kind, state: g.next[id]! });
      await this.io.writeE2eeRecords(rows);
      for (const [groupId, g] of byGroup) this.stores.set(groupId, g.next);
      this.notify();
    });
  }
}

const NONE: readonly GroupRecord[] = [];
