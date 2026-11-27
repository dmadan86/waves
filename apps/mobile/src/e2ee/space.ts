/**
 * The couple space as this phone holds it: every record's merge state (hlcs and
 * tombstones included), per group, in memory and in `e2ee_records`.
 *
 * Pure of React Native: the store is passed in, so tests drive two phones with
 * nothing but a fake mailbox between them.
 */

import { e2ee } from '@waves/core';

import type { BackupCouple } from '@/lib/backup/payload';
import type { E2eeOutboxRow, E2eeRecordRow } from '@/sync/store';

type Store = e2ee.Store;

export class E2eeMessageTooLargeError extends Error {
  readonly code = 'E2EE_MESSAGE_TOO_LARGE';
  constructor() {
    super('This rental update is too large to sync. Shorten the attached text and try again.');
  }
}

function validateOpsSize(ops: readonly unknown[]): void {
  for (const op of ops) {
    const bytes = new TextEncoder().encode(
      e2ee.encodeJson({ v: 1, msgId: 'x'.repeat(160), ops: [op] }),
    ).length;
    if (1 + 160 + 40 + bytes > e2ee.MAX_MESSAGE_BYTES) throw new E2eeMessageTooLargeError();
  }
}

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
  /** Seal for this one device only (a snapshot answer), not the whole group. */
  readonly to?: string;
  /** Recipient/part deliveries already accepted by the mailbox RPC. */
  readonly delivered?: readonly string[];
  readonly deliveryIds?: Readonly<Record<string, string>>;
}

/** A group this phone has left (or was removed from, or that was deleted): a read-only copy. */
export const FORMER = 'former:';
const META = '__former';
const PENDING = '__meta:pending';
export const isFormer = (groupId: string): boolean => groupId.startsWith(FORMER);

export interface SpaceIo {
  readE2eeRecords(): Promise<E2eeRecordRow[]>;
  writeE2eeRecords(
    rows: readonly E2eeRecordRow[],
    outbox?: readonly E2eeOutboxRow[],
  ): Promise<void>;
  /** Replace every row and message of `groupId` with `rows` (stored under their own group ids). */
  replaceE2eeGroup(groupId: string, rows: readonly E2eeRecordRow[]): Promise<void>;
}

export interface Incoming {
  readonly groupId: string;
  readonly ops: readonly e2ee.MergeOp[];
  readonly senderMemberId: string;
  /** A snapshot from a partner's phone: first-sight author checks do not apply. */
  readonly trusted?: boolean;
  /** With `trusted`: an unknown record's author must be one of these (the group's members). */
  readonly authors?: ReadonlySet<string>;
}

/** A snapshot's records as merge ops (a put per record, plus its delete stamp). */
export function snapshotOps(records: readonly e2ee.RecordState[]): e2ee.MergeOp[] {
  const ops: e2ee.MergeOp[] = [];
  for (const r of records) {
    if (r.createdBy !== '')
      ops.push({ op: 'put', id: r.id, kind: r.kind, createdBy: r.createdBy, fields: r.fields });
    if (r.deleted !== undefined) ops.push({ op: 'del', id: r.id, hlc: r.deleted });
  }
  return ops;
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
  private pendingByGroup = new Map<string, e2ee.MergeOp[]>();
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
    const pendingByGroup = new Map<string, e2ee.MergeOp[]>();
    for (const r of rows) {
      if (r.id === PENDING) {
        try {
          const pending = JSON.parse(String(r.state.fields.value?.[0] ?? '[]')) as e2ee.MergeOp[];
          pendingByGroup.set(r.groupId, pending);
        } catch {
          // A corrupt local pending row is ignored; normal record rows remain readable.
        }
        continue;
      }
      const s = stores.get(r.groupId) ?? {};
      s[r.id] = r.state;
      stores.set(r.groupId, s);
    }
    this.stores = stores;
    this.pendingByGroup = pendingByGroup;
    this.notify();
  }

  /** Sign-out: the tables are wiped by the store; this drops what is in memory. */
  clear(): void {
    this.stores = new Map();
    this.pendingByGroup = new Map();
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
      if (rec.createdBy === '' || rec.kind.startsWith('_')) continue;
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

  /** Whether this phone kept a read-only copy of a group it left. */
  hasFormer(groupId: string): boolean {
    return this.stores.has(FORMER + groupId);
  }

  /** Every record of a live group as merge state, tombstones included (a snapshot, a backup). */
  snapshot(groupId: string): e2ee.RecordState[] {
    return Object.values(this.stores.get(groupId) ?? {}).filter((r) => !r.kind.startsWith('_'));
  }

  /** Live groups only: never a read-only former couple. */
  liveGroupIds(): string[] {
    return this.groupIds().filter((g) => !isFormer(g));
  }

  /** Former couples, for the read-only section under Personal -> Rentals. */
  formerGroups(): { groupId: string; name: string }[] {
    return this.groupIds()
      .filter(isFormer)
      .map((groupId) => ({
        groupId,
        name: String(this.stores.get(groupId)?.[META]?.fields.name?.[0] ?? ''),
      }));
  }

  /** Queue a message that carries no record change (a resync request or answer). */
  queue(groupId: string, ops: readonly unknown[], to?: string): Promise<void> {
    return this.run(async () => {
      validateOpsSize(ops);
      const msgId = this.clock.newId();
      const msg: OutboxMsg = { plaintext: { v: 1, msgId, ops }, hint: null, ...(to ? { to } : {}) };
      await this.io.writeE2eeRecords(
        [],
        [{ id: msgId, groupId, msg, createdAt: new Date(this.clock.now()).toISOString() }],
      );
      this.onOutbox?.();
    });
  }

  /** Records for a backup: one entry per live group that has any. */
  backupCouple(nameOf: (groupId: string) => string): BackupCouple[] {
    return this.groupIds()
      .map((storedId) => {
        const former = isFormer(storedId);
        const groupId = former ? storedId.slice(FORMER.length) : storedId;
        return { groupId, storedId, former, records: this.snapshot(storedId) };
      })
      .filter((g) => g.records.length > 0)
      .map((g) => ({
        groupId: g.groupId,
        name: g.former
          ? String(this.stores.get(g.storedId)?.[META]?.fields.name?.[0] ?? nameOf(g.groupId))
          : nameOf(g.groupId),
        records: e2ee.encodeJson(g.records),
        ...(g.former ? { former: true } : {}),
      }));
  }

  /**
   * Merge a backup back in (trusted, like a snapshot), straight into the tables and never
   * into the send queue. A group the account is no longer in comes back as a former couple.
   */
  async restoreCouple(
    entries: readonly BackupCouple[],
    liveGroupIds: readonly string[],
  ): Promise<void> {
    for (const c of entries) {
      if (this.stores.has(FORMER + c.groupId)) continue;
      const records = e2ee.decodeJson(c.records) as e2ee.RecordState[];
      await this.applyIncoming([
        { groupId: c.groupId, ops: snapshotOps(records), senderMemberId: '', trusted: true },
      ]);
      if (c.former || !liveGroupIds.includes(c.groupId)) await this.retire(c.groupId, c.name);
    }
  }

  /**
   * The phone is no longer in this group: keep what it holds as a read-only copy, on this
   * phone only. Rows are re-tagged `former:<id>`; unsent messages for the group are dropped.
   */
  retire(groupId: string, name: string): Promise<void> {
    return this.run(async () => {
      const store = this.stores.get(groupId);
      if (isFormer(groupId) || !store || Object.keys(store).length === 0) return;
      const fid = FORMER + groupId;
      const meta: e2ee.RecordState = {
        id: META,
        kind: '_former',
        createdBy: '_',
        fields: { name: [name, '0'] },
      };
      const next: Store = { ...store, [META]: meta };
      const rows = Object.values(next).map((r) => ({
        groupId: fid,
        id: r.id,
        kind: r.kind,
        state: r,
      }));
      await this.io.replaceE2eeGroup(groupId, rows);
      this.stores.delete(groupId);
      this.stores.set(fid, next);
      this.notify();
    });
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
    const rows = touched.flatMap((id) => {
      const state = next[id];
      return state ? [{ groupId, id, kind: state.kind, state }] : [];
    });
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
      if (isFormer(groupId)) throw new Error('e2ee: a former couple is read-only');
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
        ...(!known ? { create: true as const } : {}),
      };
      const rent =
        !known && kind === 'txn' && data.kind === 'income' && data.category === 'inc.rent';
      await this.send(groupId, me, store, [op], [id], rent ? 'rent_recorded' : null);
    });
  }

  /** Delete one record, locally first. A tombstone, so a late edit cannot bring it back. */
  del(groupId: string, me: Me, id: string): Promise<void> {
    return this.run(async () => {
      if (isFormer(groupId)) throw new Error('e2ee: a former couple is read-only');
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
    validateOpsSize(ops);
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
  applyIncoming(
    entries: readonly Incoming[],
    canCommit: () => boolean = () => true,
  ): Promise<boolean> {
    if (entries.length === 0) return Promise.resolve(true);
    return this.run(async () => {
      const pendingUpdates = new Map<string, e2ee.MergeOp[]>();
      const byGroup = new Map<string, { next: Store; touched: Set<string> }>();
      for (const e of entries) {
        const g = byGroup.get(e.groupId) ?? {
          next: this.stores.get(e.groupId) ?? {},
          touched: new Set<string>(),
        };
        let ops = e.ops;
        if (e.trusted) {
          // A snapshot never changes a known record's author, and never names a stranger.
          const base = g.next;
          ops = ops.flatMap((op): e2ee.MergeOp[] => {
            if (op.op !== 'put') return [op];
            const known = base[op.id];
            if (known && known.createdBy !== '') return [{ ...op, createdBy: known.createdBy }];
            return e.authors && !e.authors.has(op.createdBy) ? [] : [op];
          });
        }
        let merged: e2ee.DetailedMergeResult;
        try {
          merged = e2ee.mergeOps(g.next, ops, e.senderMemberId, { trusted: e.trusted });
        } catch {
          throw new e2ee.E2eeError('E2EE_DECODE_FAILED');
        }
        const combinedPending = [
          ...(pendingUpdates.get(e.groupId) ?? this.pendingByGroup.get(e.groupId) ?? []),
          ...merged.pending,
        ];
        let replayed: e2ee.Store;
        try {
          replayed = e2ee.mergePending(merged.store, combinedPending, e.senderMemberId);
        } catch {
          throw new e2ee.E2eeError('E2EE_DECODE_FAILED');
        }
        const remaining = (replayed as unknown as { pending: readonly e2ee.MergeOp[] }).pending;
        const unique = [...new Map(remaining.map((op) => [e2ee.encodeJson(op), op])).values()];
        pendingUpdates.set(e.groupId, unique);
        g.next = replayed;
        for (const op of e.ops) g.touched.add(op.id);
        byGroup.set(e.groupId, g);
      }
      const rows: E2eeRecordRow[] = [];
      for (const [groupId, g] of byGroup)
        for (const id of g.touched)
          if (g.next[id]) rows.push({ groupId, id, kind: g.next[id]!.kind, state: g.next[id]! });
      const persistedPending = new Map(this.pendingByGroup);
      for (const [groupId, pending] of pendingUpdates) persistedPending.set(groupId, pending);
      for (const [groupId, pending] of persistedPending) {
        const state: e2ee.RecordState = {
          id: PENDING,
          kind: '_pending',
          createdBy: '_',
          fields: { value: [e2ee.encodeJson(pending), '0'] },
        };
        rows.push({ groupId, id: PENDING, kind: '_pending', state });
      }
      if (!canCommit()) return false;
      await this.io.writeE2eeRecords(rows);
      for (const [groupId, pending] of pendingUpdates) this.pendingByGroup.set(groupId, pending);
      for (const [groupId, g] of byGroup) this.stores.set(groupId, g.next);
      this.notify();
      return true;
    });
  }
}

const NONE: readonly GroupRecord[] = [];
