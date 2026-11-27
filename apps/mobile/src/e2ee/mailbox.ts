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

import { fromBytea, toBytea } from './deviceKey';
import {
  diffDevices,
  removedDevices,
  memoryMeta,
  NoticeStore,
  type KnownDevice,
  type Meta,
  type DeviceStatus,
  isDeviceRevoked,
  markDeviceRevoked,
} from './deviceNotice';
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
    updateE2eeOutbox(row: E2eeOutboxRow): Promise<void>;
  };
  keys: { pair(): Promise<e2ee.DeviceKeyPair>; deviceId(): Promise<string> };
  /** The couple/home groups this account is in right now (from the sync mirror). */
  groups?(): readonly string[];
  /** Small durable key-value (last fetch, last ask, known devices, notices). In memory when absent. */
  meta?: Meta;
  randomBytes(length: number): Uint8Array;
  now(): number;
  report(error: unknown, where: string): void;
  /** False means this account/device has been removed or revoked server-side. */
  deviceStatus?: DeviceStatus;
  /** Session/generation guard supplied by runtime. */
  isCurrent?: () => boolean;
  /** Stable operation scope; unlike isCurrent this must not follow a later session. */
  captureCurrent?: () => () => boolean;
}

interface GroupDevice {
  deviceId: string;
  memberId: string;
  publicKey: Uint8Array;
}

const DEVICES_TTL_MS = 60_000;
const MAX_ITEMS_PER_CALL = 200;
const MAX_CALL_BYTES = 480 * 1024;
const FETCH_PAGE = 200;
/** The server purges unfetched mail after 30 days, so a phone away that long must ask for a snapshot. */
const STALE_MS = 30 * 24 * 3_600_000;
/** Leave five days for clock skew and network recovery before SQL receipt cleanup. */
const OUTBOX_MAX_AGE_MS = 25 * 24 * 3_600_000;
/** One snapshot per requester per hour, and one request per group per hour. */
const RESYNC_GAP_MS = 3_600_000;
/** Pads the msgId while chunking: room for the real id and the `to` field the answer adds. */
const CHUNK_PAD = 'x'.repeat(160);
/** Exact bytes this message takes on the server: frame byte + msgId + nonce + tag + plaintext. */
const wireSize = (pt: e2ee.Plaintext): number =>
  1 + utf8.encode(pt.msgId).length + 40 + utf8.encode(e2ee.encodeJson(pt)).length;
const fits = (pt: e2ee.Plaintext): boolean => wireSize(pt) <= e2ee.MAX_MESSAGE_BYTES;

const utf8 = new TextEncoder();
export const pairCacheKey = (ownDeviceId: string, peerDeviceId: string, kv: string): string =>
  `${kv}:${ownDeviceId}:${peerDeviceId}`;
class TransientMailboxError extends Error {
  constructor(readonly cause: unknown) {
    super('e2ee: transient mailbox dependency failure');
  }
}

async function metaRead(meta: Meta, key: string): Promise<string | null> {
  try {
    return await meta.get(key);
  } catch (error) {
    throw new TransientMailboxError(error);
  }
}
async function metaWrite(meta: Meta, key: string, value: string): Promise<void> {
  try {
    await meta.set(key, value);
  } catch (error) {
    throw new TransientMailboxError(error);
  }
}

async function transient<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new TransientMailboxError(error);
  }
}

/** Halve a message until each part fits; a single op that still does not is returned alone. */
function splitToFit(pt: e2ee.Plaintext): e2ee.Plaintext[] {
  if (fits(pt) || pt.ops.length < 2) return [pt];
  const mid = pt.ops.length >> 1;
  return [
    ...splitToFit({ ...pt, msgId: `${pt.msgId}.a`, ops: pt.ops.slice(0, mid) }),
    ...splitToFit({ ...pt, msgId: `${pt.msgId}.b`, ops: pt.ops.slice(mid) }),
  ];
}

function frame(msgId: string, sealed: Uint8Array, senderDevice?: string): Uint8Array {
  const id = utf8.encode(msgId);
  const sender = senderDevice ? utf8.encode(senderDevice) : null;
  if (sender && (sender.length > 255 || id.length > 255)) throw new Error('e2ee: bad frame');
  if (sender) {
    const out = new Uint8Array(3 + sender.length + id.length + sealed.length);
    out[0] = 0; // Versioned header; legacy frames begin with a nonzero msgId length.
    out[1] = sender.length;
    out.set(sender, 2);
    out[2 + sender.length] = id.length;
    out.set(id, 3 + sender.length);
    out.set(sealed, 3 + sender.length + id.length);
    return out;
  }
  const out = new Uint8Array(1 + id.length + sealed.length);
  out[0] = id.length;
  out.set(id, 1);
  out.set(sealed, 1 + id.length);
  return out;
}

function unframe(bytes: Uint8Array): { msgId: string; sealed: Uint8Array; senderDevice?: string } {
  if (bytes[0] === 0) {
    const senderLength = bytes[1] ?? 0;
    const idOffset = 2 + senderLength;
    const idLength = bytes[idOffset] ?? 0;
    if (!senderLength || !idLength || bytes.length < idOffset + 1 + idLength)
      throw new Error('e2ee: bad frame');
    return {
      senderDevice: new TextDecoder().decode(bytes.subarray(2, idOffset)),
      msgId: new TextDecoder().decode(bytes.subarray(idOffset + 1, idOffset + 1 + idLength)),
      sealed: bytes.subarray(idOffset + 1 + idLength),
    };
  }
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
  const parts = new Map<string, Set<number>>();
  const devicesCache = new Map<string, { at: number; list: GroupDevice[] }>();
  const pairKeys = new Map<string, Uint8Array>();
  const attempts = new Map<string, { n: number; next: number }>();
  let flushing: Promise<void> | null = null;
  let flushAgain = false;
  const reported = new Set<string>();
  const isCurrent = (): boolean => deps.isCurrent?.() ?? true;
  const captureCurrent = (): (() => boolean) => deps.captureCurrent?.() ?? isCurrent;
  const fixedPayloadError = (): e2ee.E2eeError => new e2ee.E2eeError('E2EE_DECODE_FAILED');

  async function revoked(current = isCurrent): Promise<boolean> {
    const id = await keys.deviceId();
    if (!current()) return true;
    const wasRevoked = await isDeviceRevoked(meta, id);
    if (!current() || wasRevoked) return true;
    if (deps.deviceStatus && !(await deps.deviceStatus(id))) {
      if (!current()) return true;
      await markDeviceRevoked(meta, id);
      return true;
    }
    return false;
  }

  const reportOnce = (error: unknown, where: string): void => {
    if (reported.has(where)) return;
    reported.add(where);
    deps.report(error, where);
  };

  async function groupDevices(
    groupId: string,
    force = false,
    current = captureCurrent(),
  ): Promise<GroupDevice[]> {
    if (!current()) return [];
    const hit = devicesCache.get(groupId);
    if (!force && hit && deps.now() - hit.at < DEVICES_TTL_MS) return hit.list;
    let response: { data: unknown; error: unknown };
    try {
      response = await client.rpc('waves_group_devices', { p_group_id: groupId });
    } catch (error) {
      throw new TransientMailboxError(error);
    }
    if (!current()) return [];
    // A successful refresh is the revocation boundary for remembered sender keys.
    // Persist it before processing rows so only mail created earlier can use that key.
    const previous = hit?.list;
    const { data, error } = response;
    if (error) throw new TransientMailboxError(error);
    let list: GroupDevice[];
    try {
      if (!Array.isArray(data)) throw new Error('e2ee: invalid device directory response');
      list = (data as { device_id: string; member_id: string; public_key: string }[]).map((d) => ({
        deviceId: d.device_id,
        memberId: d.member_id,
        publicKey: fromBytea(d.public_key),
      }));
    } catch (cause) {
      throw new TransientMailboxError(cause);
    }
    let oldRaw: string | null;
    try {
      oldRaw = await meta.get(`devices:${groupId}`);
    } catch (cause) {
      throw new TransientMailboxError(cause);
    }
    if (!current()) return [];
    const oldDevices = previous ?? (oldRaw ? (JSON.parse(oldRaw) as KnownDevice[]) : null);
    if (oldDevices) {
      const present = new Set(list.map((d) => d.deviceId));
      for (const old of oldDevices) {
        if (!present.has(old.deviceId)) {
          const key = `sender:${groupId}:${old.deviceId}:removedAt`;
          let removedAt: string | null;
          try {
            removedAt = await meta.get(key);
          } catch (cause) {
            throw new TransientMailboxError(cause);
          }
          if (!current()) return [];
          if (removedAt === null) {
            try {
              await meta.set(key, String(deps.now()));
            } catch (cause) {
              throw new TransientMailboxError(cause);
            }
          }
          if (!current()) return [];
        }
      }
    }
    devicesCache.set(groupId, { at: deps.now(), list });
    for (const device of list) {
      if (!current()) return [];
      await rememberSender(groupId, device, current);
    }
    return list;
  }

  async function keyFor(peer: GroupDevice): Promise<Uint8Array> {
    let ownId: string;
    try {
      ownId = await keys.deviceId();
    } catch (error) {
      throw new TransientMailboxError(error);
    }
    const cacheKey = pairCacheKey(ownId, peer.deviceId, 'v2');
    const cached = pairKeys.get(cacheKey);
    if (cached) return cached;
    let device: e2ee.DeviceKeyPair;
    try {
      device = await keys.pair();
    } catch (error) {
      throw new TransientMailboxError(error);
    }
    const key = e2ee.pairKey(device.privateKey, peer.publicKey);
    pairKeys.set(cacheKey, key);
    return key;
  }

  async function legacyKeyFor(peer: GroupDevice): Promise<Uint8Array> {
    const device = await keys.pair();
    return e2ee.pairKeyV1(device.privateKey, peer.publicKey);
  }

  async function rememberSender(
    groupId: string,
    device: GroupDevice,
    current = captureCurrent(),
  ): Promise<void> {
    if (!current()) return;
    await metaWrite(
      meta,
      `sender:${groupId}:${device.deviceId}`,
      JSON.stringify({
        memberId: device.memberId,
        publicKey: toBytea(device.publicKey),
      }),
    );
  }

  async function rememberedSender(
    groupId: string,
    deviceId: string,
  ): Promise<GroupDevice | undefined> {
    const raw = await metaRead(meta, `sender:${groupId}:${deviceId}`);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as { memberId: string; publicKey: string };
    return { deviceId, memberId: value.memberId, publicKey: fromBytea(value.publicKey) };
  }

  function stableDeliveryId(
    sender: string,
    recipient: string,
    msgId: string,
    part: number,
  ): string {
    // Four independently seeded 32-bit FNV lanes produce a deterministic 128-bit UUID body.
    const input = `${sender}|${recipient}|${msgId}|${part}`;
    const lanes = [2166136261, 2246822519, 3266489917, 668265263].map((seed) => {
      let h = seed;
      for (const c of input) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
      return (h >>> 0).toString(16).padStart(8, '0');
    });
    const hex =
      lanes.join('').slice(0, 12) +
      '4' +
      lanes.join('').slice(13, 16) +
      '8' +
      lanes.join('').slice(17, 20) +
      lanes.join('').slice(20, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  type SendResult = 'sent' | 'wait';

  /** Seal one outbox message for every other device in the group and hand it to the server. */
  async function sendOne(row: E2eeOutboxRow, current = isCurrent): Promise<SendResult> {
    const isCurrent = current;
    if (!isCurrent() || (await revoked(isCurrent)) || !isCurrent()) return 'wait';
    const msg = row.msg as OutboxMsg;
    const me = await keys.deviceId();
    if (!isCurrent()) return 'wait';
    const recipients = (await groupDevices(row.groupId, false, isCurrent)).filter(
      (d) => d.deviceId !== me && (msg.to === undefined || d.deviceId === msg.to),
    );
    if (!isCurrent()) return 'wait';
    // Nobody to tell yet (the partner has not set up): keep it for when they do.
    // A targeted resync answer is obsolete once that device leaves the directory.
    if (recipients.length === 0) return msg.to ? 'sent' : 'wait';
    const parts = splitToFit(msg.plaintext);
    if (parts.some((p) => !fits(p))) {
      deps.report(new Error('e2ee: record too large to send'), 'e2ee.send.tooLarge');
      return 'wait';
    }
    let first = true;
    const delivered = new Set<string>(
      (msg as OutboxMsg & { delivered?: string[] }).delivered ?? [],
    );
    const deliveryIds: Record<string, string> = { ...((msg as OutboxMsg).deliveryIds ?? {}) };
    for (let partIndex = 0; partIndex < parts.length; partIndex++)
      for (const recipient of recipients) {
        const key = `${partIndex}:${recipient.deviceId}`;
        deliveryIds[key] ??= stableDeliveryId(
          me,
          recipient.deviceId,
          parts[partIndex]!.msgId,
          partIndex,
        );
      }
    if (JSON.stringify(deliveryIds) !== JSON.stringify((msg as OutboxMsg).deliveryIds ?? {})) {
      if (!isCurrent()) return 'wait';
      await outbox.updateE2eeOutbox({ ...row, msg: { ...msg, deliveryIds } });
      if (!isCurrent()) return 'wait';
    }
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex]!;
      const items: { recipient_device: string; ciphertext: string; delivery_id: string }[] = [];
      for (const r of recipients) {
        if (delivered.has(`${r.deviceId}:${partIndex}`)) continue;
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
          if (!isCurrent()) return 'wait';
          items.push({
            recipient_device: r.deviceId,
            ciphertext: bytesToBase64(frame(part.msgId, sealed, me)),
            delivery_id: deliveryIds[`${partIndex}:${r.deviceId}`]!,
          });
        } catch (error) {
          reportOnce(error, 'e2ee.send.seal');
        }
      }
      if (items.length === 0) continue;
      const batches: (typeof items)[] = [];
      let batch: typeof items = [];
      let bytes = 0;
      for (const item of items) {
        const size = Math.floor((item.ciphertext.length * 3) / 4);
        if (size > MAX_CALL_BYTES) {
          await meta.set(
            `outbox-failed:${row.groupId}`,
            JSON.stringify({ at: deps.now(), reason: 'item-too-large' }),
          );
          await outbox.deleteE2eeOutbox([row.id]);
          reportOnce(new Error('e2ee: item exceeds mailbox call limit'), 'e2ee.send.tooLarge');
          return 'sent';
        }
        if (batch.length >= MAX_ITEMS_PER_CALL || bytes + size > MAX_CALL_BYTES) {
          batches.push(batch);
          batch = [];
          bytes = 0;
        }
        batch.push(item);
        bytes += size;
      }
      if (batch.length) batches.push(batch);
      for (const chunk of batches) {
        const { error } = await client.rpc('waves_mailbox_send', {
          p_group_id: row.groupId,
          p_sender_device: me,
          p_items: chunk,
          p_event_id: msg.plaintext.msgId,
          // Only the first call of a message may notify, or one rent entry pings twice.
          p_hint: first ? msg.hint : null,
        });
        if (!isCurrent()) return 'wait';
        if (error) throw error;
        for (const item of chunk) delivered.add(`${item.recipient_device}:${partIndex}`);
        if (!isCurrent()) return 'wait';
        await outbox.updateE2eeOutbox({
          ...row,
          msg: { ...msg, deliveryIds, delivered: [...delivered] },
        });
        if (!isCurrent()) return 'wait';
        first = false;
      }
    }
    return parts.every((_, partIndex) =>
      recipients.every((recipient) => delivered.has(`${recipient.deviceId}:${partIndex}`)),
    )
      ? 'sent'
      : 'wait';
  }

  async function runOutbox(): Promise<void> {
    const isCurrent = captureCurrent();
    const rows = await outbox.readE2eeOutbox();
    if (!isCurrent() || (await revoked(isCurrent)) || !isCurrent()) return;
    const blockedGroups = new Set<string>();
    for (const row of rows) {
      if (blockedGroups.has(row.groupId)) continue;
      if (deps.now() - Date.parse(row.createdAt) >= OUTBOX_MAX_AGE_MS) {
        if (!isCurrent()) return;
        await meta.set(
          `outbox-failed:${row.groupId}`,
          JSON.stringify({ at: deps.now(), reason: 'expired' }),
        );
        await outbox.deleteE2eeOutbox([row.id]);
        continue;
      }
      const failureRaw = await meta.get(`outbox-failed:${row.groupId}`);
      if (failureRaw) {
        let reason = 'unknown';
        try {
          reason = String((JSON.parse(failureRaw) as { reason?: unknown }).reason ?? reason);
        } catch {
          /* old marker */
        }
        if (reason !== 'expired') {
          blockedGroups.add(row.groupId);
          continue;
        }
      }
      if (!isCurrent()) return;
      const state = attempts.get(row.id);
      if (state && deps.now() < state.next) {
        blockedGroups.add(row.groupId);
        continue;
      }
      try {
        const result = await sendOne(row, isCurrent);
        if (!isCurrent()) return;
        if (result === 'wait') {
          blockedGroups.add(row.groupId);
          continue;
        }
        if (!isCurrent()) return;
        await outbox.deleteE2eeOutbox([row.id]);
        attempts.delete(row.id);
      } catch (error) {
        const cause = error instanceof TransientMailboxError ? error.cause : error;
        const message = String((cause as { message?: unknown })?.message ?? cause).toLowerCase();
        if (message.includes('not a member') || message.includes('not_member')) {
          if (!isCurrent()) return;
          await meta.set(
            `outbox-failed:${row.groupId}`,
            JSON.stringify({ at: deps.now(), reason: 'membership-lost' }),
          );
          blockedGroups.add(row.groupId);
          reportOnce(
            new Error('e2ee: group membership lost; outbox quarantined'),
            `e2ee.send.membership:${row.groupId}`,
          );
          continue;
        }
        const n = (state?.n ?? 0) + 1;
        attempts.set(row.id, { n, next: deps.now() + backoffMs(n) });
        // This group's later messages remain ordered; independent groups continue.
        blockedGroups.add(row.groupId);
        reportOnce(error, `e2ee.send.retry:${row.groupId}`);
        continue;
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
    created_at: string;
  }

  /** Fetch my mail, merge it, then delete it from the server. */
  async function fetch(): Promise<number> {
    const isCurrent = captureCurrent();
    const me = await keys.deviceId();
    if (!isCurrent() || (await revoked(isCurrent)) || !isCurrent()) return 0;
    let applied = 0;
    const refreshed = new Set<string>();
    const asked = new Set<string>();
    const closed = new Set<string>();
    for (const g of deps.groups?.() ?? []) {
      const at = Number((await meta.get(`open:${g}`)) ?? 0);
      if (!isCurrent()) return applied;
      if (deps.now() - at < 24 * RESYNC_GAP_MS) asked.add(g);
    }
    for (let round = 0; round < 10; round++) {
      const res = await client
        .from('group_mailbox')
        .select('id, group_id, sender_device_id, ciphertext, created_at')
        .eq('recipient_device_id', me)
        .order('created_at', { ascending: true })
        .limit(FETCH_PAGE);
      if (!isCurrent()) return applied;
      if (res.error) throw res.error;
      const rows = (res.data ?? []) as Row[];
      if (rows.length === 0) break;

      const entries: Incoming[] = [];
      const answers: { groupId: string; to: string; rowId: string }[] = [];
      const done: string[] = [];
      for (const row of rows) {
        if (!isCurrent()) return applied;
        try {
          const framed = unframe(fromBytea(row.ciphertext));
          const senderId = framed.senderDevice ?? row.sender_device_id ?? '';
          let devices: GroupDevice[] = [];
          let directoryChecked = false;
          try {
            devices = await groupDevices(row.group_id, false, isCurrent);
            directoryChecked = true;
            if (!isCurrent()) return applied;
          } catch (error) {
            const cause = (error as TransientMailboxError).cause ?? error;
            const message =
              String((cause as { message?: unknown; code?: unknown })?.message ?? '') +
              ' ' +
              String((cause as { code?: unknown })?.code ?? '');
            const normalized = message.toLowerCase();
            if (!normalized.includes('not a member') && !normalized.includes('not_member'))
              throw error;
          }
          let sender = devices.find((d) => d.deviceId === senderId);
          if (!sender && !refreshed.has(row.group_id)) {
            refreshed.add(row.group_id);
            try {
              devices = await groupDevices(row.group_id, true, isCurrent);
              directoryChecked = true;
              if (!isCurrent()) return applied;
              sender = devices.find((d) => d.deviceId === senderId);
            } catch (error) {
              const cause = (error as TransientMailboxError).cause ?? error;
              const message =
                `${String((cause as { message?: unknown })?.message ?? '')} ${String((cause as { code?: unknown })?.code ?? '')}`.toLowerCase();
              if (!message.includes('not a member') && !message.includes('not_member')) throw error;
            }
          }
          if (!sender) {
            sender = await rememberedSender(row.group_id, senderId);
            if (!isCurrent()) return applied;
            if (sender && directoryChecked) {
              const removedAt = Number(
                (await metaRead(meta, `sender:${row.group_id}:${senderId}:removedAt`)) ?? NaN,
              );
              if (!isCurrent()) return applied;
              const createdAt = Date.parse(row.created_at);
              if (
                !Number.isFinite(removedAt) ||
                !Number.isFinite(createdAt) ||
                createdAt >= removedAt
              ) {
                await quarantine(row, 'revoked-sender', isCurrent);
                done.push(row.id);
                continue;
              }
            }
          }
          if (!sender) throw new Error('e2ee: unknown sender device');
          await rememberSender(row.group_id, sender, isCurrent);
          if (!isCurrent()) return applied;
          // A group this phone has left: its mail is not for the copy it kept.
          if (space.hasFormer(row.group_id) && !(deps.groups?.() ?? []).includes(row.group_id)) {
            await quarantine(row, 'former-group', isCurrent);
            done.push(row.id);
            continue;
          }
          const { msgId, sealed } = framed;
          const key = await keyFor(sender);
          if (!isCurrent()) return applied;
          const aad = {
            groupId: row.group_id,
            senderDevice: sender.deviceId,
            recipientDevice: me,
            msgId,
          };
          let pt: e2ee.Plaintext;
          try {
            pt = e2ee.open(key, sealed, aad);
          } catch (error) {
            if (!(error instanceof e2ee.E2eeError) || error.code !== 'E2EE_DECODE_FAILED')
              throw error;
            pt = e2ee.open(await legacyKeyFor(sender), sealed, aad);
          }
          if (!isCurrent()) return applied;
          if (pt.msgId !== msgId) throw new Error('e2ee: msgId mismatch');
          if (!Array.isArray(pt.ops) || typeof pt.msgId !== 'string') throw fixedPayloadError();
          const rawOps = Array.isArray(pt.ops) ? (pt.ops as unknown[]) : [];
          const mergeInput = rawOps.filter(
            (op) =>
              !!op &&
              typeof op === 'object' &&
              ((op as { op?: unknown }).op === 'put' || (op as { op?: unknown }).op === 'del'),
          );
          const validation = e2ee.validateMessage({ msgId: pt.msgId, ops: mergeInput });
          if (!validation.ok || validation.rejected.length > 0) throw fixedPayloadError();
          const merge: e2ee.MergeOp[] = [];
          const snap: e2ee.RecordState[] = [];
          // An op this build does not know is skipped.
          for (const op of rawOps as ({ op: string } | e2ee.SnapshotOp)[]) {
            if (op.op === 'put' || op.op === 'del') merge.push(op as e2ee.MergeOp);
            else if (op.op === 'snapshot') {
              const so = op as e2ee.SnapshotOp & { to?: unknown };
              const snapshotValidation = e2ee.validateMessage({
                msgId: pt.msgId,
                ops: Array.isArray(so.records) ? snapshotOps(so.records) : [],
              });
              if (
                !snapshotValidation.ok ||
                snapshotValidation.rejected.length > 0 ||
                typeof so.to !== 'string' ||
                !Number.isInteger(so.part) ||
                !Number.isInteger(so.of) ||
                so.of < 1 ||
                so.part < 0 ||
                so.part >= so.of
              )
                throw fixedPayloadError();
              // Sealed for this phone already; `to` also has to say so.
              if (so.to === me) {
                snap.push(...so.records);
                const key = `${row.group_id}|${sender.deviceId}|${so.of}`;
                const seen = (parts.get(key) ?? new Set<number>()).add(so.part);
                parts.set(key, seen);
                if (seen.size === so.of) {
                  parts.delete(key);
                  closed.add(row.group_id);
                }
              } else
                reportOnce(
                  new Error('e2ee: snapshot not addressed to this phone'),
                  'e2ee.snapshot',
                );
            } else if (op.op === 'resync_req')
              answers.push({ groupId: row.group_id, to: sender.deviceId, rowId: row.id });
          }
          if (merge.length > 0)
            entries.push({ groupId: row.group_id, ops: merge, senderMemberId: sender.memberId });
          // Parts merge as they arrive: last-write-wins is order-free, so no reassembly.
          if (snap.length > 0)
            entries.push({
              groupId: row.group_id,
              ops: snapshotOps(snap),
              senderMemberId: sender.memberId,
              // Only an answer to a request this phone made: an unsolicited snapshot may not
              // name another member as author (it then goes through the normal author checks).
              trusted: asked.has(row.group_id),
              // (untrusted when unsolicited: reported below)
              authors: new Set(devices.map((d) => d.memberId)),
            });
          if (snap.length > 0 && !asked.has(row.group_id))
            reportOnce(new Error('e2ee: unsolicited snapshot'), 'e2ee.snapshot');
          done.push(row.id);
        } catch (error) {
          if (error instanceof TransientMailboxError) throw error;
          // Invalid/undecryptable rows are acknowledged only after durable quarantine.
          if (!isCurrent()) return applied;
          await quarantine(row, 'invalid', isCurrent);
          if (!isCurrent()) return applied;
          reportOnce(
            error instanceof e2ee.E2eeError ? error : fixedPayloadError(),
            'e2ee.fetch.undecryptable',
          );
          done.push(row.id);
        }
      }
      if (!isCurrent()) return applied;
      const committed = await space.applyIncoming(entries, isCurrent);
      if (!committed || !isCurrent()) return applied;
      applied += entries.length;
      for (const g of closed) {
        if (!isCurrent()) return applied;
        await meta.set(`open:${g}`, '0');
        if (!isCurrent()) return applied;
      }
      for (const a of answers) {
        if (!isCurrent()) return applied;
        const queued = await answer(a.groupId, a.to, a.rowId);
        if (!isCurrent()) return applied;
        if (!queued) {
          const index = done.indexOf(a.rowId);
          if (index >= 0) done.splice(index, 1);
        }
      }
      if (done.length > 0) {
        if (!isCurrent()) return applied;
        const del = await client.from('group_mailbox').delete().in('id', done);
        if (!isCurrent()) return applied;
        if (del.error) throw del.error;
      }
      if (rows.length < FETCH_PAGE || done.length === 0) break;
    }
    return applied;
  }

  async function quarantine(row: Row, reason: string, current = captureCurrent()): Promise<void> {
    if (!current()) return;
    const key = `quarantine:${row.id}`;
    const existing = await meta.get(key);
    if (existing !== null || !current()) return;
    await meta.set(
      key,
      JSON.stringify({
        group_id: row.group_id,
        sender_device_id: row.sender_device_id,
        ciphertext: row.ciphertext,
        reason,
      }),
    );
  }

  /** Send my whole group state to one phone that asked, at most once an hour per phone. */
  async function answer(groupId: string, to: string, requestId: string): Promise<boolean> {
    const current = captureCurrent();
    const answerKey = `${to}|${groupId}`;
    const last = answered.get(answerKey) ?? Number((await meta.get(`answer:${answerKey}`)) ?? NaN);
    if (!current()) return false;
    if (last !== undefined && deps.now() - last < RESYNC_GAP_MS) return true;
    const records = space.snapshot(groupId);
    if (records.length === 0) return true;
    try {
      for (const part of e2ee.chunkSnapshot(records, CHUNK_PAD, to)) {
        const op = { ...part, to };
        const fingerprint = e2ee.encodeJson(op);
        if (!current()) return false;
        const id = stableDeliveryId(
          `snapshot:${groupId}`,
          to,
          `${requestId}|${fingerprint}`,
          part.part,
        );
        await space.queue(groupId, [op], to, id);
        if (!current()) return false;
      }
      if (!current()) return false;
      answered.set(answerKey, deps.now());
      await meta.set(`answer:${answerKey}`, String(deps.now()));
      if (!current()) return false;
      return current();
    } catch {
      // Not the error itself: it names a record id.
      reportOnce(new Error('e2ee: snapshot too large to send'), 'e2ee.resync.answer');
      return false;
    }
  }

  /** Ask the group's other phones for everything (a new phone, or one away over 30 days). */
  async function requestResync(groupId: string): Promise<void> {
    const current = captureCurrent();
    if (!current()) return;
    await meta.set(`asked:${groupId}`, String(deps.now()));
    if (!current()) return;
    // Open until every part of the answer has arrived: only then may a snapshot be trusted.
    await meta.set(`open:${groupId}`, String(deps.now()));
    if (!current()) return;
    await space.queue(groupId, [{ op: 'resync_req' }]);
  }

  /** After a good fetch: ask for a snapshot if due, and look for a partner's new phone. */
  async function housekeeping(): Promise<void> {
    const current = captureCurrent();
    const fetchedAt = Number((await meta.get('fetchedAt')) ?? NaN);
    if (!current()) return;
    const now = deps.now();
    for (const groupId of deps.groups?.() ?? []) {
      try {
        const asked = Number((await meta.get(`asked:${groupId}`)) ?? 0);
        if (!current()) return;
        const due =
          space.snapshot(groupId).length === 0 ||
          Number.isNaN(fetchedAt) ||
          now - fetchedAt > STALE_MS;
        if (due && now - asked >= RESYNC_GAP_MS) await requestResync(groupId);
        if (!current()) return;

        const currentDevices: KnownDevice[] = (await groupDevices(groupId, false, current)).map(
          (d) => ({
            deviceId: d.deviceId,
            memberId: d.memberId,
          }),
        );
        if (!current()) return;
        const me = await keys.deviceId();
        if (!current()) return;
        const raw = await meta.get(`devices:${groupId}`);
        if (!current()) return;
        const known = raw === null ? null : (JSON.parse(raw) as KnownDevice[]);
        const fresh = diffDevices(
          known,
          currentDevices,
          currentDevices.find((d) => d.deviceId === me)?.memberId ?? null,
        );
        const myMember = currentDevices.find((d) => d.deviceId === me)?.memberId ?? null;
        if (!current()) return;
        await notices.add([
          ...fresh.map((d) => ({ ...d, groupId })),
          ...removedDevices(known, currentDevices, myMember).map((d) => ({
            ...d,
            groupId,
            removed: true,
          })),
        ]);
        if (!current()) return;
        await meta.set(`devices:${groupId}`, JSON.stringify(currentDevices));
        if (!current()) return;
      } catch (error) {
        reportOnce(error, 'e2ee.housekeeping');
      }
    }
    if (!current()) return;
    await meta.set('fetchedAt', String(now));
  }

  /** One round: pick up mail, then send what is waiting. */
  async function sync(): Promise<void> {
    const current = captureCurrent();
    if (!current() || (await revoked(current)) || !current()) return;
    let failure: unknown = null;
    try {
      await fetch();
      if (!current()) return;
      await housekeeping();
      if (!current()) return;
    } catch (error) {
      failure = error;
    }
    try {
      if (!current()) return;
      await flushOutbox();
      if (!current()) return;
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
    forgetDevices: () => {
      devicesCache.clear();
      pairKeys.clear();
    },
    async failedOutboxGroups(): Promise<{ groupId: string; reason: string }[]> {
      const rows = await outbox.readE2eeOutbox();
      const groups = [...new Set([...rows.map((row) => row.groupId), ...(deps.groups?.() ?? [])])];
      const failed: { groupId: string; reason: string }[] = [];
      for (const groupId of groups) {
        const raw = await meta.get(`outbox-failed:${groupId}`);
        if (!raw) continue;
        let reason = 'unknown';
        try {
          reason = String((JSON.parse(raw) as { reason?: unknown }).reason ?? reason);
        } catch {
          // Older failure markers carried no structured reason.
        }
        failed.push({ groupId, reason });
      }
      return failed;
    },
  };
}

export type Mailbox = ReturnType<typeof createMailbox>;
