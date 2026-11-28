import { e2ee } from '@waves/core';
import { describe, expect, it, vi } from 'vitest';

import { fromBytea, toBytea } from '../src/e2ee/deviceKey';
import { base64ToBytes } from '../src/sync/rowCipher';
import { pairCacheKey } from '../src/e2ee/mailbox';
import { FakeServer, phone } from './e2eeFake';

vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-crypto', () => ({}));

const G = 'group-1';

function world() {
  const server = new FakeServer();
  server.groups.set(G, [
    { memberId: 'mA', profileId: 'pA' },
    { memberId: 'mB', profileId: 'pB' },
  ]);
  return server;
}

const prop = { name: 'Flat 4', currency: 'INR', status: 'active' };

describe('stale device return', () => {
  it('asks for a snapshot when the server says this device was stale', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1, undefined, [G]);
    const b = phone(server, 'pB', 'mB', 2, a.clock, [G]);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await b.sync();
    await a.sync();
    await b.sync();
    expect(Object.keys(b.data(G))).toEqual(['p1']);
    // While b was stale nothing was addressed to it.
    await a.set(G, 'p2', 'property', prop);
    await a.mailbox.flushOutbox();
    server.mailbox.length = 0;
    a.clock.t += 2 * 3_600_000;
    server.staleDevices.add(await b.deviceId());
    await b.sync();
    await a.sync();
    await b.sync();
    expect(Object.keys(b.data(G)).sort()).toEqual(['p1', 'p2']);
  });
});

describe('partner device changes', () => {
  it('seals to a partner device registered after the directory was cached', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1, undefined, [G]);
    const b = phone(server, 'pB', 'mB', 2, a.clock, [G]);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox(); // caches the directory with one B device
    const b2 = phone(server, 'pB', 'mB', 3, a.clock, [G]);
    const b2Id = await b2.deviceId();
    await a.set(G, 'p2', 'property', prop);
    await a.mailbox.flushOutbox(); // well inside the 60s cache
    expect(server.mailbox.some((m) => m.recipient_device_id === b2Id)).toBe(true);
  });

  it('a phone whose device id changed asks for a snapshot', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1, undefined, [G]);
    const b = phone(server, 'pB', 'mB', 2, a.clock, [G]);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await b.sync();
    await a.sync();
    await b.sync();
    expect(Object.keys(b.data(G))).toEqual(['p1']);
    await a.set(G, 'p2', 'property', prop); // goes to the old B id only
    await a.mailbox.flushOutbox();
    server.mailbox.length = 0;
    b.rotateDevice(9);
    a.clock.t += 2 * 3_600_000;
    await b.sync();
    await a.sync();
    await b.sync();
    expect(Object.keys(b.data(G)).sort()).toEqual(['p1', 'p2']);
  });

  it('does not queue a fresh snapshot request every round while housekeeping keeps failing', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1, undefined, [G]);
    const b = phone(server, 'pB', 'mB', 2, a.clock, [G]);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await b.sync();
    await a.sync();
    await b.sync();
    b.rotateDevice(9);
    server.failDirectory = 1000;
    for (let i = 0; i < 5; i++) {
      b.clock.t += 120_000;
      await b.sync().catch(() => undefined);
    }
    expect(b.store.outbox.size).toBeLessThanOrEqual(1);
  });
});

describe('housekeeping failures', () => {
  it('skips a group the server no longer lets this phone into, silently, every round', async () => {
    const server = world();
    server.groups.set('group-lost', [{ memberId: 'mC', profileId: 'pC' }]);
    const a = phone(server, 'pA', 'mA', 1, undefined, [G, 'group-lost']);
    await a.deviceId();
    for (let i = 0; i < 6; i++) {
      a.clock.t += 120_000;
      await a.sync().catch(() => undefined);
    }
    expect(a.reports.map((r) => r.where).filter((w) => w.startsWith('e2ee.housekeeping'))).toEqual(
      [],
    );
  });

  it('turns a group the server no longer lets this phone into a read-only former copy', async () => {
    const server = world();
    server.groups.set('group-lost', [{ memberId: 'mC', profileId: 'pC' }]);
    const a = phone(server, 'pA', 'mA', 1, undefined, [G, 'group-lost']);
    await a.deviceId();
    await a.set('group-lost', 'p1', 'property', prop);
    for (let i = 0; i < 3; i++) {
      a.clock.t += 120_000;
      await a.sync().catch(() => undefined);
    }
    expect(a.space.hasFormer('group-lost')).toBe(true);
    expect(a.space.formerGroups().map((g) => g.groupId)).toEqual(['former:group-lost']);
    expect(a.space.liveGroupIds()).not.toContain('group-lost');
    expect(a.reports.map((r) => r.where).filter((w) => w.startsWith('e2ee.housekeeping'))).toEqual(
      [],
    );
  });

  it('a transient failure is retried silently, a persistent one is reported', async () => {
    const server = world();
    const b = phone(server, 'pB', 'mB', 2, undefined, [G]);
    await b.deviceId();
    await b.sync(); // settle first-run work
    server.failDirectory = 2;
    b.clock.t += 120_000; // past the directory cache
    await b.sync().catch(() => undefined);
    await b.sync().catch(() => undefined);
    expect(b.reports.map((r) => r.where)).not.toContain('e2ee.housekeeping.directory');
    server.failDirectory = 100;
    for (let i = 0; i < 6; i++) {
      b.clock.t += 120_000;
      await b.sync().catch(() => undefined);
    }
    expect(b.reports.map((r) => r.where)).toContain('e2ee.housekeeping.directory');
  });
});

describe('mailbox send', () => {
  it('isolates cached pair keys when two accounts share the same peer device', () => {
    expect(pairCacheKey('account-a-device', 'shared-peer', 'v2')).not.toBe(
      pairCacheKey('account-b-device', 'shared-peer', 'v2'),
    );
  });
  it('retains a partially sealed message and retries the failed recipient', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2, undefined, [G]);
    const c = phone(server, 'pB', 'mB', 3);
    await Promise.all([a.deviceId(), b.deviceId(), c.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    const seal = e2ee.seal;
    const failedRecipient = await b.deviceId();
    vi.spyOn(e2ee, 'seal').mockImplementation((key, plaintext, aad, nonce) => {
      if (aad.recipientDevice === failedRecipient) throw new Error('temporary key failure');
      return seal(key, plaintext, aad, nonce);
    });
    await a.mailbox.flushOutbox();
    expect(a.store.outbox.size).toBe(1);
    expect(server.mailbox).toHaveLength(1);
    vi.mocked(e2ee.seal).mockRestore();
    await a.mailbox.flushOutbox();
    expect(a.store.outbox.size).toBe(0);
    expect(server.mailbox).toHaveLength(2);
    expect(seal).toBeDefined();
  });

  it('keeps an outbox item when there are zero recipient devices', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    await a.deviceId();
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();
    expect(a.store.outbox.size).toBe(1);
  });

  it('does not send an outbox item owned by another profile', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    const row = [...a.store.outbox.values()][0]!;
    row.msg = { ...(row.msg as Record<string, unknown>), owner: 'pB' } as typeof row.msg;
    await a.mailbox.flushOutbox();
    expect(server.mailbox).toHaveLength(0);
    expect(a.store.outbox.has(row.id)).toBe(true);
  });

  it('does not let a no-recipient group block a later group', async () => {
    const server = world();
    server.groups.set('group-2', [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mC', profileId: 'pC' },
    ]);
    const a = phone(server, 'pA', 'mA', 1);
    const c = phone(server, 'pC', 'mC', 2);
    await Promise.all([a.deviceId(), c.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await a.set('group-2', 'p2', 'property', prop);
    await a.mailbox.flushOutbox();
    expect(server.mailbox.map((row) => row.group_id)).toEqual(['group-2']);
    expect(a.store.outbox.size).toBe(1);
  });

  it('a send refused as not-a-member retires the group and leaves nothing blocked', async () => {
    const server = world();
    server.groups.set('group-lost', [{ memberId: 'mC', profileId: 'pC' }]);
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set('group-lost', 'l1', 'property', prop);
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();
    // The other group still went out; the lost one is a read-only former copy with an empty outbox.
    expect(server.mailbox).toHaveLength(1);
    expect(a.store.outbox.size).toBe(0);
    expect(a.space.hasFormer('group-lost')).toBe(true);
    expect(await a.mailbox.failedOutboxGroups()).toEqual([]);
    expect(a.reports.map((r) => r.where)).not.toContain('e2ee.send.membership:group-lost');
  });

  it('a re-added member gets the group back live: sends work and the partner resyncs', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1, undefined, [G]);
    const b = phone(server, 'pB', 'mB', 2, a.clock, [G]);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await a.sync();
    await b.sync();
    expect(Object.keys(b.data(G))).toEqual(['p1']);
    // A is removed on the server; its next send is refused and the space becomes a former copy.
    server.groups.set(G, [{ memberId: 'mB', profileId: 'pB' }]);
    await a.set(G, 'p2', 'property', prop);
    await a.mailbox.flushOutbox();
    expect(a.space.hasFormer(G)).toBe(true);
    // A is added back under the same group id; B writes meanwhile.
    server.groups.set(G, [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mB', profileId: 'pB' },
    ]);
    await b.set(G, 'p3', 'property', prop);
    for (let i = 0; i < 4; i++) {
      a.clock.t += 120_000;
      await a.sync().catch(() => undefined);
      await b.sync().catch(() => undefined);
    }
    expect(a.space.hasFormer(G)).toBe(false);
    expect(a.space.liveGroupIds()).toContain(G);
    await a.set(G, 'p4', 'property', prop);
    await a.sync();
    await b.sync();
    expect(Object.keys(b.data(G)).sort()).toContain('p4');
    expect(Object.keys(a.data(G)).sort()).toEqual(expect.arrayContaining(['p1', 'p3', 'p4']));
  });

  it('drops queued messages of a refused group even when it holds no records', async () => {
    const server = world();
    server.groups.set('group-lost', [{ memberId: 'mC', profileId: 'pC' }]);
    const a = phone(server, 'pA', 'mA', 1);
    await a.deviceId();
    await a.space.queue('group-lost', [{ op: 'resync_req' }]);
    await a.mailbox.flushOutbox();
    expect(a.store.outbox.size).toBe(0);
    expect(await a.mailbox.failedOutboxGroups()).toEqual([]);
  });

  it('expires an outbox item before receipt cleanup and reports the permanent reason', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1, undefined, [G]);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    const row = [...a.store.outbox.values()][0]!;
    row.createdAt = new Date(a.clock.t - 26 * 24 * 60 * 60 * 1000).toISOString();
    await a.mailbox.flushOutbox();
    expect(server.mailbox).toHaveLength(0);
    expect(await a.mailbox.failedOutboxGroups()).toEqual([{ groupId: G, reason: 'expired' }]);
  });

  it('drops only expired rows and continues sending later rows for the group', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1, undefined, [G]);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'old', 'property', prop);
    const old = [...a.store.outbox.values()][0]!;
    old.createdAt = new Date(a.clock.t - 26 * 24 * 60 * 60 * 1000).toISOString();
    await a.set(G, 'new', 'property', { ...prop, name: 'Later' });
    await a.mailbox.flushOutbox();
    expect(server.mailbox.length).toBeGreaterThan(0);
    expect([...a.store.outbox.values()].map((row) => row.id)).not.toContain(old.id);
    expect(await a.mailbox.failedOutboxGroups()).toEqual([{ groupId: G, reason: 'expired' }]);
  });

  it('rejects an oversized local edit before it is committed', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    await expect(a.set(G, 'large', 'property', { note: 'x'.repeat(70_000) })).rejects.toMatchObject(
      { code: 'E2EE_MESSAGE_TOO_LARGE' },
    );
    expect(a.store.outbox.size).toBe(0);
    expect(a.data(G).large).toBeUndefined();
  });

  it('persists and reuses delivery ids after the server accepted a lost response', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await b.mailbox.sync(); // persist the authenticated device and member binding locally
    server.failAfterAccept = 1;
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();
    const first = server.sends[0]!.ids;
    a.clock.t += 60 * 60 * 1000;
    await a.mailbox.flushOutbox();
    expect(server.sends[1]!.ids).toEqual(first);
    expect(server.mailbox).toHaveLength(1);
    expect(server.sends[1]!.eventId).toBe(server.sends[0]!.eventId);
  });

  it('seals one message per recipient device, own other phones included, never this one', async () => {
    const server = world();
    const a1 = phone(server, 'pA', 'mA', 1);
    const a2 = phone(server, 'pA', 'mA', 2);
    const b1 = phone(server, 'pB', 'mB', 3);
    await Promise.all([a1.deviceId(), a2.deviceId(), b1.deviceId()]);

    await a1.set(G, 'p1', 'property', prop);
    await a1.mailbox.flushOutbox();

    const to = server.mailbox.map((r) => r.recipient_device_id).sort();
    expect(to).toEqual([await a2.deviceId(), await b1.deviceId()].sort());
    expect(server.sends).toHaveLength(1);

    // The row opens only with the right pair key and the AAD of its own route.
    const b1Id = await b1.deviceId();
    const a2Id = await a2.deviceId();
    const row = server.mailbox.find((r) => r.recipient_device_id === b1Id)!;
    const bytes = fromBytea(row.ciphertext);
    const senderLength = bytes[1]!;
    const msgOffset = 2 + senderLength;
    const msgLength = bytes[msgOffset]!;
    const msgId = new TextDecoder().decode(
      bytes.subarray(msgOffset + 1, msgOffset + 1 + msgLength),
    );
    const sealed = bytes.subarray(msgOffset + 1 + msgLength);
    const aad = {
      groupId: G,
      senderDevice: await a1.deviceId(),
      recipientDevice: b1Id,
      msgId,
    };
    const key = e2ee.pairKey(b1.key.privateKey, a1.key.publicKey);
    const pt = e2ee.open(key, sealed, aad);
    expect(pt.kv).toBe(2);
    expect(pt.ops[0]).toMatchObject({ op: 'put', id: 'p1', kind: 'property', createdBy: 'mA' });
    expect(() => e2ee.open(key, sealed, { ...aad, recipientDevice: a2Id })).toThrow();
    expect(() => e2ee.open(key, sealed, { ...aad, groupId: 'other' })).toThrow();
  });

  it('authenticates the sender id from the sealed envelope when the row column is null', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();
    server.mailbox[0]!.sender_device_id = null;
    expect(await b.mailbox.fetch()).toBeGreaterThan(0);
    expect(b.data(G).p1).toMatchObject({ name: 'Flat 4' });
  });

  it('discards a blocked fetch after the account generation changes', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();
    let release!: () => void;
    let entered!: () => void;
    const atFetch = new Promise<void>((resolve) => (entered = resolve));
    server.fetchGate = new Promise<void>((resolve) => (release = resolve));
    server.fetchStarted = entered;
    const running = b.mailbox.fetch();
    await atFetch;
    b.endSession();
    b.startSession();
    release();
    expect(await running).toBe(0);
    expect(b.data(G)).toEqual({});
    expect(server.mailbox).toHaveLength(1);
  });

  it('sends at most 200 items per call and notifies only on the first', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    await a.deviceId();
    for (let i = 0; i < 450; i++)
      server.devices.push({
        id: server.nextId('x'),
        profileId: 'pB',
        publicKey: e2ee.generateDeviceKeyPair(() => new Uint8Array(32).fill(10 + (i % 200)))
          .publicKey,
      });
    await a.set(G, 't1', 'txn', { kind: 'income', category: 'inc.rent', amount: '100' });
    await a.mailbox.flushOutbox();
    expect(server.sends.map((s) => s.items)).toEqual([200, 200, 50]);
    expect(server.sends.map((s) => s.hint)).toEqual(['rent_recorded', null, null]);
  });

  it('does not hint for an edit or a non-rent entry', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'x', 'txn', { kind: 'expense', category: 'exp.repairs', amount: '5' });
    await a.set(G, 'x', 'txn', { kind: 'expense', category: 'exp.repairs', amount: '6' });
    await a.mailbox.flushOutbox();
    expect(server.sends.map((s) => s.hint)).toEqual([null, null]);
  });

  it('splits a message that would not fit one sealed envelope', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    const big = 'x'.repeat(8_000);
    const ops = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(
      (id) =>
        ({
          op: 'put',
          id,
          kind: 'property',
          createdBy: 'mA',
          create: true,
          fields: { notes: [big, e2ee.tick(null, Date.now(), 'test')] },
        }) as const,
    );
    // Four 20 KB records in one message: over 64 KiB, so it goes as several.
    await a.store.writeE2eeRecords(
      [],
      [
        {
          id: 'm-big',
          groupId: G,
          msg: { plaintext: { v: 1, msgId: 'm-big', ops }, hint: null },
          createdAt: 'x',
        },
      ],
    );
    await a.mailbox.flushOutbox();
    expect(server.mailbox.length).toBeGreaterThan(1);
    expect(server.mailbox.every((r) => fromBytea(r.ciphertext).length <= 65536)).toBe(true);
    const got = await b.mailbox.fetch();
    expect(got).toBeGreaterThan(0);
    expect(Object.keys(b.data(G)).sort(), JSON.stringify(b.reports)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
    ]);
  });

  it('keeps a message in the outbox when sending fails, and retries after the backoff', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    server.failSends = 1;
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox().catch(() => undefined);
    expect(a.store.outbox.size).toBe(1);
    expect(server.mailbox).toHaveLength(0);

    await expect(a.mailbox.flushOutbox()).resolves.toBeUndefined(); // still backing off: no call
    expect(a.store.outbox.size).toBe(1);

    a.clock.t += 60 * 60 * 1000;
    await a.mailbox.flushOutbox();
    expect(a.store.outbox.size).toBe(0);
    await b.sync();
    expect(b.data(G).p1).toMatchObject(prop);
  });

  it('holds a message until someone else has a device', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    await a.deviceId();
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();
    expect(a.store.outbox.size).toBe(1);
    const b = phone(server, 'pB', 'mB', 2);
    await b.deviceId();
    a.mailbox.forgetDevices();
    await a.mailbox.flushOutbox();
    await b.sync();
    expect(b.data(G).p1).toMatchObject(prop);
  });
});

describe('mailbox fetch', () => {
  it('leaves mail unacked on a transient directory failure, then merges on retry', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();
    b.mailbox.forgetDevices();
    server.failDirectory = 1;
    await b.sync().catch(() => undefined);
    expect(server.mailbox).toHaveLength(1);
    await b.sync();
    expect(b.data(G).p1).toMatchObject(prop);
    expect(server.mailbox).toHaveLength(0);
  });

  it('leaves mail unacked when the own device id read fails during a directory refresh', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();
    b.mailbox.forgetDevices();
    b.failDeviceId(1);
    await b.sync().catch(() => undefined);
    expect(server.mailbox).toHaveLength(1);
    expect((b.store as any).quarantine).toHaveLength(0);
    await b.sync();
    expect(b.data(G).p1).toMatchObject(prop);
  });

  it('quarantines invalid ciphertext durably before acknowledging it', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    server.mailbox.push({
      id: 'invalid',
      group_id: G,
      sender_device_id: await a.deviceId(),
      recipient_device_id: await b.deviceId(),
      ciphertext: '\\x00',
      created_at: 'x',
    });
    await b.sync();
    expect(server.mailbox).toHaveLength(0);
    expect((b.store as any).quarantine).toHaveLength(1);
  });

  it('reads mail from a sender who has since left the group', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2, undefined, [G]);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await b.mailbox.sync();
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();
    b.clock.t += 61_000; // Expire the cached directory to exercise the persisted binding.
    server.groups.set(G, [{ memberId: 'mB', profileId: 'pB' }]);
    await b.sync();
    expect(b.data(G).p1).toMatchObject(prop);
  });

  it('quarantines mail created after a successful directory refresh removed its sender', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2, undefined, [G]);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await b.mailbox.sync();
    await a.set(G, 'old', 'property', prop);
    await a.mailbox.flushOutbox();
    const aId = await a.deviceId();
    const bId = await b.deviceId();
    const original = server.mailbox.find(
      (row) => row.sender_device_id === aId && row.recipient_device_id === bId,
    )!;
    server.groups.set(G, [{ memberId: 'mB', profileId: 'pB' }]);
    b.clock.t += 61_000;
    // First fetch observes removal; this row was created after that observation.
    server.mailbox = [];
    await b.sync();
    server.mailbox.push({
      ...original,
      id: 'new-after-revocation',
      created_at: new Date(b.clock.t + 1).toISOString(),
    });
    await b.sync();
    expect(b.data(G).old).toBeUndefined();
    expect(b.store.quarantine).toContainEqual(
      expect.objectContaining({ reason: 'revoked-sender' }),
    );
    expect(server.mailbox).toHaveLength(0);
  });

  it('still applies a sender message created before the removal was observed', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2, undefined, [G]);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await b.mailbox.sync();
    await a.set(G, 'before-removal', 'property', prop);
    await a.mailbox.flushOutbox();
    const created = server.mailbox[0]!.created_at;
    server.groups.set(G, [{ memberId: 'mB', profileId: 'pB' }]);
    b.clock.t += 61_000;
    await b.sync(); // successful refresh records the sender's removal
    expect(server.mailbox).toHaveLength(1);
    expect(new Date(created).getTime()).toBeLessThan(b.clock.t);
    await b.sync();
    expect(b.data(G)['before-removal']).toMatchObject(prop);
  });

  it('resets the sender cutoff on rejoin so a later departure gets a new cutoff', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2, undefined, [G]);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await b.mailbox.sync();
    await a.set(G, 'cutoff-row', 'property', prop);
    await a.mailbox.flushOutbox();
    const aId = await a.deviceId();
    const bId = await b.deviceId();
    const original = server.mailbox.find((row) => row.sender_device_id === aId)!;
    server.groups.set(G, [{ memberId: 'mB', profileId: 'pB' }]);
    b.clock.t += 61_000;
    await b.sync();
    server.groups.set(G, [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mB', profileId: 'pB' },
    ]);
    b.clock.t += 61_000;
    await b.sync();
    server.groups.set(G, [{ memberId: 'mB', profileId: 'pB' }]);
    b.clock.t += 61_000;
    await b.sync();
    const cutoff = b.clock.t;
    server.mailbox = [
      {
        ...original,
        id: 'between',
        recipient_device_id: bId,
        created_at: new Date(cutoff - 1).toISOString(),
      },
      {
        ...original,
        id: 'after',
        recipient_device_id: bId,
        created_at: new Date(cutoff + 1).toISOString(),
      },
    ];
    await b.sync();
    expect(b.store.quarantine).toContainEqual(
      expect.objectContaining({ reason: 'revoked-sender' }),
    );
    expect(b.data(G)['cutoff-row']).toMatchObject(prop);
    expect(server.mailbox.map((row) => row.id)).not.toContain('after');
  });

  it('applies the ops, then deletes only this phone’s rows', async () => {
    const server = world();
    const a1 = phone(server, 'pA', 'mA', 1);
    const a2 = phone(server, 'pA', 'mA', 2);
    const b = phone(server, 'pB', 'mB', 3);
    await Promise.all([a1.deviceId(), a2.deviceId(), b.deviceId()]);
    await a1.set(G, 'p1', 'property', prop);
    await a1.mailbox.flushOutbox();
    expect(server.mailbox).toHaveLength(2);

    await b.sync();
    expect(b.data(G).p1).toMatchObject(prop);
    expect(server.mailbox).toHaveLength(1); // a2's copy is still waiting
    await a2.sync(); // my own other phone gets it too
    expect(a2.data(G).p1).toMatchObject(prop);
    expect(server.mailbox).toHaveLength(0);
  });

  it('applies a whole batch in one write to the local store', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    for (const id of ['p1', 'p2', 'p3']) await a.set(G, id, 'property', { ...prop, name: id });
    await a.mailbox.flushOutbox();
    const before = b.store.writes;
    await b.sync();
    expect(b.store.writes - before).toBe(1);
    expect(Object.keys(b.data(G))).toHaveLength(3);
  });

  it('deletes an undecryptable row, logs it once and keeps the rest flowing', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    const bId = await b.deviceId();
    for (const junk of ['\\x0401020304aa', '\\x00', '\\x03abc' + 'ff'.repeat(60)])
      server.mailbox.push({
        id: server.nextId('bad'),
        group_id: G,
        sender_device_id: await a.deviceId(),
        recipient_device_id: bId,
        ciphertext: junk,
        created_at: '2020-01-01T00:00:00.000Z',
      });
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();

    await b.sync();
    expect(server.mailbox).toHaveLength(0);
    expect(b.data(G).p1).toMatchObject(prop);
    expect(b.reports).toHaveLength(1);
    expect(b.reports[0]!.where).toBe('e2ee.fetch.undecryptable');
  });

  it('keeps the mail when applying it fails, so nothing is lost', async () => {
    const server = world();
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', prop);
    await a.mailbox.flushOutbox();
    const write = b.store.writeE2eeRecords.bind(b.store);
    b.store.writeE2eeRecords = async () => {
      throw new Error('disk full');
    };
    await expect(b.sync()).rejects.toThrow('disk full');
    expect(server.mailbox).toHaveLength(1);
    b.store.writeE2eeRecords = write;
    await b.sync();
    expect(b.data(G).p1).toMatchObject(prop);
    expect(server.mailbox).toHaveLength(0);
  });

  it('ignores a message whose sender is not in the group', async () => {
    const server = world();
    const b = phone(server, 'pB', 'mB', 2);
    await b.deviceId();
    server.mailbox.push({
      id: server.nextId('bad'),
      group_id: G,
      sender_device_id: 'nobody',
      recipient_device_id: await b.deviceId(),
      ciphertext: toBytea(base64ToBytes('AAAA')),
      created_at: '2020-01-01T00:00:00.000Z',
    });
    await b.sync();
    expect(server.mailbox).toHaveLength(0);
    expect(b.data(G)).toEqual({});
  });
});
