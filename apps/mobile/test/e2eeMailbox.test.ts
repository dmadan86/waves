import { e2ee } from '@waves/core';
import { describe, expect, it, vi } from 'vitest';

import { fromBytea, toBytea } from '../src/e2ee/deviceKey';
import { base64ToBytes } from '../src/sync/rowCipher';
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

describe('mailbox send', () => {
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
    const msgId = new TextDecoder().decode(bytes.subarray(1, 1 + bytes[0]!));
    const sealed = bytes.subarray(1 + bytes[0]!);
    const aad = {
      groupId: G,
      senderDevice: await a1.deviceId(),
      recipientDevice: b1Id,
      msgId,
    };
    const key = e2ee.pairKey(b1.key.privateKey, a1.key.publicKey);
    const pt = e2ee.open(key, sealed, aad);
    expect(pt.ops[0]).toMatchObject({ op: 'put', id: 'p1', kind: 'property', createdBy: 'mA' });
    expect(() => e2ee.open(key, sealed, { ...aad, recipientDevice: a2Id })).toThrow();
    expect(() => e2ee.open(key, sealed, { ...aad, groupId: 'other' })).toThrow();
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
    const big = 'x'.repeat(20_000);
    const ops = ['a', 'b', 'c', 'd'].map(
      (id) =>
        ({
          op: 'put',
          id,
          kind: 'property',
          createdBy: 'mA',
          fields: { note: [big, '1:0:x'] },
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
    await b.sync();
    expect(Object.keys(b.data(G)).sort()).toEqual(['a', 'b', 'c', 'd']);
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
