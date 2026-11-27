/** A fake Supabase for the couple mailbox: devices, a mailbox table, RLS-by-caller. */

import { e2ee } from '@waves/core';

import { fromBytea, toBytea } from '../src/e2ee/deviceKey';
import { createMailbox } from '../src/e2ee/mailbox';
import { E2eeSpace } from '../src/e2ee/space';
import type { E2eeOutboxRow, E2eeRecordRow } from '../src/sync/store';

interface Device {
  id: string;
  profileId: string;
  publicKey: Uint8Array;
}
interface MailRow {
  id: string;
  group_id: string;
  sender_device_id: string | null;
  recipient_device_id: string;
  ciphertext: string;
  created_at: string;
}

export class FakeServer {
  devices: Device[] = [];
  mailbox: MailRow[] = [];
  /** group id -> member list {memberId, profileId} */
  groups = new Map<string, { memberId: string; profileId: string }[]>();
  sends: {
    groupId: string;
    sender: string;
    items: number;
    hint: string | null;
    ids: string[];
    eventId: string | null;
  }[] = [];
  failSends = 0;
  failAfterAccept = 0;
  failDirectory = 0;
  /** Devices the server would report as stale on their next waves_device_seen. */
  staleDevices = new Set<string>();
  sendAttempts = 0;
  failAtSendAttempt: number | null = null;
  private n = 0;
  private clock = 0;
  fetchGate: Promise<void> | null = null;
  fetchStarted: (() => void) | null = null;

  nextId(prefix: string): string {
    this.n += 1;
    return `${prefix}-${String(this.n).padStart(8, '0')}-0000-4000-8000-000000000000`;
  }

  /** The client one signed-in profile would hold. */
  client(profileId: string) {
    const server = this;
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        try {
          if (fn === 'waves_register_device') {
            const key = fromBytea(args.p_public_key as string);
            let d = server.devices.find(
              (x) => x.profileId === profileId && Buffer.compare(x.publicKey, key) === 0,
            );
            if (!d) {
              d = { id: server.nextId('dev'), profileId, publicKey: key };
              server.devices.push(d);
            }
            return { data: d.id, error: null };
          }
          if (fn === 'waves_device_seen')
            return { data: server.staleDevices.delete(args.p_device_id as string), error: null };
          if (fn === 'waves_group_devices') {
            if (server.failDirectory > 0) {
              server.failDirectory -= 1;
              return { data: null, error: { message: 'directory offline' } };
            }
            const members = server.groups.get(args.p_group_id as string) ?? [];
            if (!members.some((m) => m.profileId === profileId))
              return { data: null, error: { message: 'Not a member of this group' } };
            const rows = members.flatMap((m) =>
              server.devices
                .filter((d) => d.profileId === m.profileId)
                .map((d) => ({
                  device_id: d.id,
                  member_id: m.memberId,
                  profile_id: m.profileId,
                  public_key: toBytea(d.publicKey),
                })),
            );
            return { data: rows, error: null };
          }
          if (fn === 'waves_mailbox_send') {
            server.sendAttempts += 1;
            if (server.sendAttempts === server.failAtSendAttempt)
              return { data: null, error: { message: 'offline on selected send attempt' } };
            if (server.failSends > 0) {
              server.failSends -= 1;
              return { data: null, error: { message: 'offline' } };
            }
            const items = args.p_items as {
              recipient_device: string;
              ciphertext: string;
              delivery_id?: string;
            }[];
            if (items.length > 200) return { data: null, error: { message: 'Too many items' } };
            server.sends.push({
              groupId: args.p_group_id as string,
              sender: args.p_sender_device as string,
              items: items.length,
              hint: (args.p_hint as string | null) ?? null,
              ids: items.map((i) => i.delivery_id ?? ''),
              eventId: (args.p_event_id as string | undefined) ?? null,
            });
            for (const i of items) {
              if (
                i.delivery_id &&
                server.mailbox.some(
                  (r) =>
                    (r as any).delivery_id === i.delivery_id &&
                    r.sender_device_id === (args.p_sender_device as string),
                )
              )
                continue;
              const bytes = Buffer.from(i.ciphertext, 'base64');
              if (bytes.length > 65536) return { data: null, error: { message: 'too big' } };
              server.clock += 1;
              server.mailbox.push({
                id: server.nextId('mail'),
                group_id: args.p_group_id as string,
                sender_device_id: args.p_sender_device as string,
                recipient_device_id: i.recipient_device,
                ciphertext: `\\x${bytes.toString('hex')}`,
                created_at: new Date(1_700_000_000_000 + server.clock).toISOString(),
                ...(i.delivery_id ? { delivery_id: i.delivery_id } : {}),
              });
            }
            if (server.failAfterAccept > 0) {
              server.failAfterAccept -= 1;
              return { data: null, error: { message: 'response lost' } };
            }
            return { data: items.length, error: null };
          }
        } catch (e) {
          return { data: null, error: { message: String(e) } };
        }
        return { data: null, error: { message: `unknown rpc ${fn}` } };
      },
      from: (table: string) => {
        if (table !== 'group_mailbox') throw new Error(`unexpected table ${table}`);
        const mine = () => server.devices.filter((d) => d.profileId === profileId).map((d) => d.id);
        const filters: { col: string; val: string }[] = [];
        let limit = Infinity;
        const q = {
          select: () => q,
          eq: (col: string, val: string) => (filters.push({ col, val }), q),
          order: () => q,
          limit: (n: number) => ((limit = n), q),
          delete: () => ({
            in: async (_c: string, ids: string[]) => {
              server.mailbox = server.mailbox.filter(
                (r) => !(ids.includes(r.id) && mine().includes(r.recipient_device_id)),
              );
              return { error: null };
            },
          }),
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            const rows = server.mailbox
              .filter((r) => mine().includes(r.recipient_device_id))
              .filter((r) =>
                filters.every((f) => (r as unknown as Record<string, string>)[f.col] === f.val),
              )
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .slice(0, limit)
              .map((r) => ({ ...r }));
            server.fetchStarted?.();
            return (server.fetchGate ?? Promise.resolve())
              .then(() => ({ data: rows, error: null }))
              .then(res, rej);
          },
        };
        return q;
      },
    };
  }
}

/** In-memory stand-in for the e2ee half of LocalStore. */
export class MemStore {
  records = new Map<string, E2eeRecordRow>();
  outbox = new Map<string, E2eeOutboxRow>();
  writes = 0;
  quarantine: unknown[] = [];
  bindings = new Map<string, { memberId: string; publicKey: Uint8Array }>();
  pending = new Map<string, e2ee.PendingOp[]>();
  async quarantineE2eeMail(row: unknown) {
    this.quarantine.push(structuredClone(row));
  }
  async readE2eeSenderBindings() {
    return [...this.bindings.entries()];
  }
  async writeE2eeSenderBinding(
    groupId: string,
    deviceId: string,
    value: { memberId: string; publicKey: Uint8Array },
  ) {
    this.bindings.set(`${groupId}:${deviceId}`, structuredClone(value));
  }
  async readE2eeRecords() {
    return [...this.records.values()];
  }
  async readE2eePending() {
    return [...this.pending.entries()].map(
      ([groupId, rows]) => [groupId, structuredClone(rows)] as [string, e2ee.PendingOp[]],
    );
  }
  async writeE2eePending(groupId: string, rows: readonly e2ee.PendingOp[]) {
    if (rows.length) this.pending.set(groupId, structuredClone([...rows]));
    else this.pending.delete(groupId);
  }
  async writeE2eeRecords(rows: readonly E2eeRecordRow[], outbox: readonly E2eeOutboxRow[] = []) {
    this.writes += 1;
    for (const r of rows) this.records.set(`${r.groupId}:${r.id}`, structuredClone(r));
    for (const o of outbox) if (!this.outbox.has(o.id)) this.outbox.set(o.id, structuredClone(o));
  }
  async replaceE2eeGroup(groupId: string, rows: readonly E2eeRecordRow[]) {
    this.pending.delete(groupId);
    for (const [k, r] of this.records) if (r.groupId === groupId) this.records.delete(k);
    for (const [k, o] of this.outbox) if (o.groupId === groupId) this.outbox.delete(k);
    for (const r of rows) this.records.set(`${r.groupId}:${r.id}`, structuredClone(r));
  }
  async readE2eeOutbox() {
    return [...this.outbox.values()];
  }
  async deleteE2eeOutbox(ids: readonly string[]) {
    for (const id of ids) this.outbox.delete(id);
  }
  async updateE2eeOutbox(row: E2eeOutboxRow) {
    if (this.outbox.has(row.id)) this.outbox.set(row.id, structuredClone(row));
  }
}

export const newKey = (seed: number) =>
  e2ee.generateDeviceKeyPair((n) => new Uint8Array(n).fill(seed));

export interface Phone {
  store: MemStore;
  space: E2eeSpace;
  mailbox: ReturnType<typeof createMailbox>;
  recreateMailbox(): ReturnType<typeof createMailbox>;
  key: e2ee.DeviceKeyPair;
  me: { memberId: string; clockId: string };
  deviceId(): Promise<string>;
  reports: { error: unknown; where: string }[];
  clock: { t: number };
  set(groupId: string, id: string, kind: string, data: Record<string, unknown>): Promise<void>;
  del(groupId: string, id: string): Promise<void>;
  sync(): Promise<number>;
  /** The groups this account is in (the mailbox's `groups()`); edit in place. */
  groups: string[];
  endSession(): void;
  startSession(): void;
  setDeviceStatus(status: boolean): void;
  /** Make the mailbox's next `n` device-id reads fail (a transient key-store error). */
  failDeviceId(n: number): void;
  data(groupId: string): Record<string, Record<string, unknown>>;
}

/** One phone signed in as `profileId`, writing as `memberId`. `seed` fixes its device key. */
export function phone(
  server: FakeServer,
  profileId: string,
  memberId: string,
  seed: number,
  clock = { t: 1_700_000_000_000 },
  groups: string[] = [],
  status: { active: boolean } = { active: true },
): Phone {
  const store = new MemStore();
  const key = newKey(seed);
  const client = server.client(profileId);
  const reports: { error: unknown; where: string }[] = [];
  let current = true;
  let sessionGeneration = 0;
  let deviceActive = status.active;
  const metaValues = new Map<string, string>();
  const meta = {
    get: async (key: string) => metaValues.get(key) ?? null,
    set: async (key: string, value: string) => {
      metaValues.set(key, value);
      if (key.startsWith('quarantine:'))
        store.quarantine = [...metaValues.entries()]
          .filter(([k]) => k.startsWith('quarantine:'))
          .map(([, v]) => JSON.parse(v));
    },
  };
  let id: Promise<string> | null = null;
  const deviceId = () =>
    (id ??= client
      .rpc('waves_register_device', { p_public_key: toBytea(key.publicKey) })
      .then((r) => r.data as string));
  const flaky = { deviceId: 0 };
  let n = 0;
  const space = new E2eeSpace(store, {
    now: () => clock.t,
    newId: () => `msg-${seed}-${(n += 1)}`,
  });
  const mailboxDeps = {
    client,
    space,
    outbox: store,
    meta,
    groups: () => groups,
    keys: {
      pair: async () => key,
      deviceId: async () => {
        if (flaky.deviceId > 0) {
          flaky.deviceId -= 1;
          throw new Error('keystore unavailable');
        }
        return deviceId();
      },
    },
    randomBytes: (len: number) => new Uint8Array(len).fill(7),
    now: () => clock.t,
    report: (error: unknown, where: string) => reports.push({ error, where }),
    isCurrent: () => current,
    captureCurrent: () => {
      const captured = sessionGeneration;
      return () => current && sessionGeneration === captured;
    },
    deviceStatus: async () => deviceActive,
  };
  let mailbox = createMailbox(mailboxDeps);
  const recreateMailbox = () => (mailbox = createMailbox(mailboxDeps));
  space.onOutbox = () => void mailbox.flushOutbox().catch(() => undefined);
  const me = { memberId, clockId: `ck${seed}` };
  return {
    store,
    space,
    get mailbox() {
      return mailbox;
    },
    recreateMailbox,
    key,
    me,
    deviceId,
    reports,
    clock,
    set: (g, i, k, d) => space.upsert(g, me, i, k, d),
    del: (g, i) => space.del(g, me, i),
    sync: () => mailbox.sync(),
    groups,
    endSession: () => {
      current = false;
      sessionGeneration += 1;
    },
    startSession: () => {
      sessionGeneration += 1;
      current = true;
    },
    failDeviceId: (n) => {
      flaky.deviceId = n;
    },
    setDeviceStatus: (active) => {
      deviceActive = active;
    },
    data: (g) => Object.fromEntries(space.records(g).map((r) => [r.id, r.data])),
  };
}
