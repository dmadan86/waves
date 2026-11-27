/**
 * The mailbox client: the server holds sealed messages only until the receiving
 * phone fetches them, then deletes them (`group_mailbox`).
 *
 * Wire format of one row's `ciphertext`: `[msgId length: 1 byte][msgId: ASCII][sealed]`.
 * The msgId is in the clear because the receiver needs it to rebuild the AAD
 * (`groupId|senderDevice|recipientDevice|msgId`); tampering with it fails the open.
 */

import { backoffMs, e2ee } from '@waves/core';

import { bytesToBase64 } from '@/sync/rowCipher';
import type { E2eeOutboxRow } from '@/sync/store';

import { fromBytea } from './deviceKey';
import { diffDevices, memoryMeta, NoticeStore, type KnownDevice, type Meta } from './deviceNotice';
import { snapshotOps, type E2eeSpace, type Incoming, type OutboxMsg } from './space';

/** The slice of the Supabase client this uses, so tests can stand in a fake server. */
export interface MailClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  from(table: string): any;
}

export interface MailboxDeps {
  client: MailClient;
  space: E2eeSpace;
  outbox: {
    readE2eeOutbox(): Promise<E2eeOutboxRow[]>;
    deleteE2eeOutbox(ids: readonly string[]): Promise<void>;
  };
  keys: { pair(): Promise<e2ee.DeviceKeyPair>; deviceId(): Promise<string> };
  /** The couple/home groups this account is in right now (from the sync mirror). */
  groups?(): readonly string[];
  /** Small durable key-value (last fetch, last ask, known devices, notices). In memory when absent. */
  meta?: Meta;
  randomBytes(length: number): Uint8Array;
  now(): number;
  report(error: unknown, where: string): void;
}

interface GroupDevice {
  deviceId: string;
  memberId: string;
  publicKey: Uint8Array;
}

const DEVICES_TTL_MS = 60_000;
const MAX_ITEMS_PER_CALL = 200;
const FETCH_PAGE = 200;
/** The server purges unfetched mail after 30 days, so a phone away that long must ask for a snapshot. */
const STALE_MS = 30 * 24 * 3_600_000;
/** One snapshot per requester per hour, and one request per group per hour. */
const RESYNC_GAP_MS = 3_600_000;
/** Pads the msgId while chunking, so a chunk also fits the sender's size budget. */
const CHUNK_PAD = 'x'.repeat(512);
/** Room for the msgId prefix, the seal and the wrapper under the server's 64 KiB limit. */
const SIZE_BUDGET = e2ee.MAX_MESSAGE_BYTES - 512;

const utf8 = new TextEncoder();

/** Halve a message until each part fits; a single op that still does not is returned alone. */
function splitToFit(pt: e2ee.Plaintext): e2ee.Plaintext[] {
  if (utf8.encode(e2ee.encodeJson(pt)).length <= SIZE_BUDGET || pt.ops.length < 2) return [pt];
  const mid = pt.ops.length >> 1;
  return [
    ...splitToFit({ ...pt, msgId: `${pt.msgId}.a`, ops: pt.ops.slice(0, mid) }),
    ...splitToFit({ ...pt, msgId: `${pt.msgId}.b`, ops: pt.ops.slice(mid) }),
  ];
}

function frame(msgId: string, sealed: Uint8Array): Uint8Array {
  const id = utf8.encode(msgId);
  const out = new Uint8Array(1 + id.length + sealed.length);
  out[0] = id.length;
  out.set(id, 1);
  out.set(sealed, 1 + id.length);
  return out;
}

function unframe(bytes: Uint8Array): { msgId: string; sealed: Uint8Array } {
  const n = bytes[0] ?? 0;
  if (n === 0 || bytes.length < 1 + n) throw new Error('e2ee: bad frame');
  return {
    msgId: new TextDecoder().decode(bytes.subarray(1, 1 + n)),
    sealed: bytes.subarray(1 + n),
  };
}

export function createMailbox(deps: MailboxDeps) {
  const { client, space, outbox, keys } = deps;
  const meta = deps.meta ?? memoryMeta();
  const notices = new NoticeStore(meta);
  const answered = new Map<string, number>();
  const devicesCache = new Map<string, { at: number; list: GroupDevice[] }>();
  const pairKeys = new Map<string, Uint8Array>();
  const attempts = new Map<string, { n: number; next: number }>();
  let flushing: Promise<void> | null = null;
  let flushAgain = false;
  const reported = new Set<string>();

  const reportOnce = (error: unknown, where: string): void => {
    if (reported.has(where)) return;
    reported.add(where);
    deps.report(error, where);
  };

  async function groupDevices(groupId: string, force = false): Promise<GroupDevice[]> {
    const hit = devicesCache.get(groupId);
    if (!force && hit && deps.now() - hit.at < DEVICES_TTL_MS) return hit.list;
    const { data, error } = await client.rpc('waves_group_devices', { p_group_id: groupId });
    if (error) throw error;
    const list = (data as { device_id: string; member_id: string; public_key: string }[]).map(
      (d) => ({
        deviceId: d.device_id,
        memberId: d.member_id,
        publicKey: fromBytea(d.public_key),
      }),
    );
    devicesCache.set(groupId, { at: deps.now(), list });
    return list;
  }

  async function keyFor(peer: GroupDevice): Promise<Uint8Array> {
    const cached = pairKeys.get(peer.deviceId);
    if (cached) return cached;
    const key = e2ee.pairKey((await keys.pair()).privateKey, peer.publicKey);
    pairKeys.set(peer.deviceId, key);
    return key;
  }

  type SendResult = 'sent' | 'wait' | 'drop';

  /** Seal one outbox message for every other device in the group and hand it to the server. */
  async function sendOne(row: E2eeOutboxRow): Promise<SendResult> {
    const msg = row.msg as OutboxMsg;
    const me = await keys.deviceId();
    const recipients = (await groupDevices(row.groupId)).filter(
      (d) => d.deviceId !== me && (msg.to === undefined || d.deviceId === msg.to),
    );
    // Nobody to tell yet (the partner has not set up): keep it for when they do.
    if (recipients.length === 0) return 'wait';
    const parts = splitToFit(msg.plaintext);
    if (parts.some((p) => utf8.encode(e2ee.encodeJson(p)).length > SIZE_BUDGET)) {
      deps.report(new Error('e2ee: record too large to send'), 'e2ee.send.tooLarge');
      return 'drop';
    }
    let first = true;
    for (const part of parts) {
      const items: { recipient_device: string; ciphertext: string }[] = [];
      for (const r of recipients) {
        try {
          const sealed = e2ee.seal(
            await keyFor(r),
            part,
            {
              groupId: row.groupId,
              senderDevice: me,
              recipientDevice: r.deviceId,
              msgId: part.msgId,
            },
            deps.randomBytes(24),
          );
          items.push({
            recipient_device: r.deviceId,
            ciphertext: bytesToBase64(frame(part.msgId, sealed)),
          });
        } catch (error) {
          reportOnce(error, 'e2ee.send.seal');
        }
      }
      for (let i = 0; i < items.length; i += MAX_ITEMS_PER_CALL) {
        const { error } = await client.rpc('waves_mailbox_send', {
          p_group_id: row.groupId,
          p_sender_device: me,
          p_items: items.slice(i, i + MAX_ITEMS_PER_CALL),
          // Only the first call of a message may notify, or one rent entry pings twice.
          p_hint: first ? msg.hint : null,
        });
        if (error) throw error;
        first = false;
      }
    }
    return 'sent';
  }

  async function runOutbox(): Promise<void> {
    const rows = await outbox.readE2eeOutbox();
    for (const row of rows) {
      const state = attempts.get(row.id);
      if (state && deps.now() < state.next) return;
      try {
        const result = await sendOne(row);
        if (result === 'wait') return;
        await outbox.deleteE2eeOutbox([row.id]);
        attempts.delete(row.id);
      } catch (error) {
        const n = (state?.n ?? 0) + 1;
        attempts.set(row.id, { n, next: deps.now() + backoffMs(n) });
        // Order matters (a record's first message must land before its edits): stop here.
        throw error;
      }
    }
  }

  /** Send what is waiting. One run at a time; a call during a run asks for one more pass. */
  function flushOutbox(): Promise<void> {
    if (flushing) {
      flushAgain = true;
      return flushing;
    }
    flushing = (async () => {
      try {
        do {
          flushAgain = false;
          await runOutbox();
        } while (flushAgain);
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  interface Row {
    id: string;
    group_id: string;
    sender_device_id: string | null;
    ciphertext: string;
  }

  /** Fetch my mail, merge it, then delete it from the server. */
  async function fetch(): Promise<number> {
    const me = await keys.deviceId();
    let applied = 0;
    const refreshed = new Set<string>();
    for (let round = 0; round < 10; round++) {
      const res = await client
        .from('group_mailbox')
        .select('id, group_id, sender_device_id, ciphertext, created_at')
        .eq('recipient_device_id', me)
        .order('created_at', { ascending: true })
        .limit(FETCH_PAGE);
      if (res.error) throw res.error;
      const rows = (res.data ?? []) as Row[];
      if (rows.length === 0) break;

      const entries: Incoming[] = [];
      const answers: { groupId: string; to: string }[] = [];
      const done: string[] = [];
      for (const row of rows) {
        try {
          let devices = await groupDevices(row.group_id);
          let sender = devices.find((d) => d.deviceId === row.sender_device_id);
          if (!sender && !refreshed.has(row.group_id)) {
            refreshed.add(row.group_id);
            devices = await groupDevices(row.group_id, true);
            sender = devices.find((d) => d.deviceId === row.sender_device_id);
          }
          if (!sender) throw new Error('e2ee: unknown sender device');
          // A group this phone has left: its mail is not for the copy it kept.
          if (space.hasFormer(row.group_id) && !(deps.groups?.() ?? []).includes(row.group_id)) {
            done.push(row.id);
            continue;
          }
          const { msgId, sealed } = unframe(fromBytea(row.ciphertext));
          const pt = e2ee.open(await keyFor(sender), sealed, {
            groupId: row.group_id,
            senderDevice: sender.deviceId,
            recipientDevice: me,
            msgId,
          });
          if (pt.msgId !== msgId) throw new Error('e2ee: msgId mismatch');
          const merge: e2ee.MergeOp[] = [];
          const snap: e2ee.RecordState[] = [];
          // An op this build does not know is skipped.
          for (const op of pt.ops as { op: string }[]) {
            if (op.op === 'put' || op.op === 'del') merge.push(op as e2ee.MergeOp);
            else if (op.op === 'snapshot') snap.push(...(op as e2ee.SnapshotOp).records);
            else if (op.op === 'resync_req')
              answers.push({ groupId: row.group_id, to: sender.deviceId });
          }
          if (merge.length > 0)
            entries.push({ groupId: row.group_id, ops: merge, senderMemberId: sender.memberId });
          // Parts merge as they arrive: last-write-wins is order-free, so no reassembly.
          if (snap.length > 0)
            entries.push({
              groupId: row.group_id,
              ops: snapshotOps(snap),
              senderMemberId: sender.memberId,
              trusted: true,
            });
          done.push(row.id);
        } catch (error) {
          // Never blocks the queue: drop it, say so once.
          reportOnce(error, 'e2ee.fetch.undecryptable');
          done.push(row.id);
        }
      }
      await space.applyIncoming(entries);
      applied += entries.length;
      for (const a of answers) await answer(a.groupId, a.to);
      if (done.length > 0) {
        const del = await client.from('group_mailbox').delete().in('id', done);
        if (del.error) throw del.error;
      }
      if (rows.length < FETCH_PAGE || done.length === 0) break;
    }
    return applied;
  }

  /** Send my whole group state to one phone that asked, at most once an hour per phone. */
  async function answer(groupId: string, to: string): Promise<void> {
    const last = answered.get(to);
    if (last !== undefined && deps.now() - last < RESYNC_GAP_MS) return;
    const records = space.snapshot(groupId);
    if (records.length === 0) return;
    answered.set(to, deps.now());
    try {
      for (const part of e2ee.chunkSnapshot(records, CHUNK_PAD))
        await space.queue(groupId, [part], to);
    } catch (error) {
      reportOnce(error, 'e2ee.resync.answer');
    }
  }

  /** Ask the group's other phones for everything (a new phone, or one away over 30 days). */
  async function requestResync(groupId: string): Promise<void> {
    await meta.set(`asked:${groupId}`, String(deps.now()));
    await space.queue(groupId, [{ op: 'resync_req' }]);
  }

  /** After a good fetch: ask for a snapshot if due, and look for a partner's new phone. */
  async function housekeeping(): Promise<void> {
    const fetchedAt = Number((await meta.get('fetchedAt')) ?? NaN);
    const now = deps.now();
    for (const groupId of deps.groups?.() ?? []) {
      try {
        const asked = Number((await meta.get(`asked:${groupId}`)) ?? 0);
        const due =
          space.snapshot(groupId).length === 0 ||
          Number.isNaN(fetchedAt) ||
          now - fetchedAt > STALE_MS;
        if (due && now - asked >= RESYNC_GAP_MS) await requestResync(groupId);

        const current: KnownDevice[] = (await groupDevices(groupId)).map((d) => ({
          deviceId: d.deviceId,
          memberId: d.memberId,
        }));
        const me = await keys.deviceId();
        const raw = await meta.get(`devices:${groupId}`);
        const known = raw === null ? null : (JSON.parse(raw) as KnownDevice[]);
        const fresh = diffDevices(
          known,
          current,
          current.find((d) => d.deviceId === me)?.memberId ?? null,
        );
        await notices.add(fresh.map((d) => ({ ...d, groupId })));
        await meta.set(`devices:${groupId}`, JSON.stringify(current));
      } catch (error) {
        reportOnce(error, 'e2ee.housekeeping');
      }
    }
    await meta.set('fetchedAt', String(now));
  }

  /** One round: pick up mail, then send what is waiting. */
  async function sync(): Promise<void> {
    let failure: unknown = null;
    try {
      await fetch();
      await housekeeping();
    } catch (error) {
      failure = error;
    }
    try {
      await flushOutbox();
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw failure;
  }

  return {
    flushOutbox,
    fetch,
    sync,
    requestResync,
    notices,
    forgetDevices: () => devicesCache.clear(),
  };
}

export type Mailbox = ReturnType<typeof createMailbox>;
