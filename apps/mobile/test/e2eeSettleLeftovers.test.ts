import { describe, expect, it, vi } from 'vitest';

import { restoreOffer } from '../src/lib/backup/restorePrompt';
import { FakeServer, phone } from './e2eeFake';
import { e2ee } from '@waves/core';
import { bytesToBase64 } from '../src/sync/rowCipher';

vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-crypto', () => ({}));

const G = 'group-settle';

describe('E2EE settle review regressions', () => {
  it('offers restore when the phone has couple data even with no personal records', () => {
    expect(
      restoreOffer({
        signedIn: true,
        isGuest: false,
        configured: true,
        connected: true,
        recordCount: 0,
        coupleCount: 2,
        settled: true,
        dismissed: false,
      } as Parameters<typeof restoreOffer>[0]),
    ).toBe('none');
  });

  it('keeps former couple records in a backup and restores them as former', async () => {
    const server = new FakeServer();
    const a = phone(server, 'pA', 'mA', 1);
    await a.set(G, 'property-1', 'property', { name: 'Flat' });
    await a.space.retire(G, 'Asha');
    const backup = a.space.backupCouple(() => 'Asha');
    expect(backup).toHaveLength(1);
    expect(backup[0]).toMatchObject({ groupId: G, name: 'Asha', former: true });
    const b = phone(server, 'pB', 'mB', 2);
    await b.space.restoreCouple(backup, []);
    expect(b.space.hasFormer(G)).toBe(true);
    expect(b.data(`former:${G}`)['property-1']?.name).toBe('Flat');
  });

  it('persists answer rate limits across mailbox instances sharing meta', async () => {
    const server = new FakeServer();
    server.groups.set(G, [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mB', profileId: 'pB' },
    ]);
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await b.set(G, 'p', 'property', { name: 'Flat' });
    await b.mailbox.flushOutbox();
    const request = async () => {
      await a.space.queue(G, [{ op: 'resync_req' }]);
      await a.mailbox.flushOutbox();
      await b.mailbox.sync();
    };
    await request();
    const firstAnswers = server.sends.length;
    b.recreateMailbox();
    await request();
    expect(server.sends).toHaveLength(firstAnswers + 1); // only A's second request was sent
  });

  it('does not write or acknowledge a fetched page after the session ends', async () => {
    const server = new FakeServer();
    server.groups.set(G, [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mB', profileId: 'pB' },
    ]);
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'r1', 'property', { name: 'Flat' });
    await a.mailbox.flushOutbox();
    await b.mailbox.sync();
    await a.set(G, 'r2', 'property', { name: 'Next' });
    await a.mailbox.flushOutbox();
    const before = b.store.writes;
    let release!: () => void;
    server.fetchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetching = b.mailbox.fetch();
    await Promise.resolve();
    await Promise.resolve();
    b.endSession();
    release();
    await fetching;
    expect(b.store.writes).toBe(before);
    const receiver = await b.deviceId();
    expect(server.mailbox.some((row) => row.recipient_device_id === receiver)).toBe(true);
  });

  it('does not report tenant text from a malformed authenticated payload', async () => {
    const server = new FakeServer();
    server.groups.set(G, [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mB', profileId: 'pB' },
    ]);
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    const [senderId, receiverId] = await Promise.all([a.deviceId(), b.deviceId()]);
    const msgId = 'bad-payload';
    const pair = e2ee.pairKey(a.key.privateKey, b.key.publicKey);
    const pt = {
      v: 1,
      msgId,
      ops: [
        {
          op: 'put',
          id: 'r',
          kind: 'rent',
          createdBy: 'mA',
          fields: { tenant: ['TENANT-SECRET', 'bad-hlc'] },
        },
      ],
    };
    const sealed = e2ee.seal(
      pair,
      pt as never,
      { groupId: G, senderDevice: senderId, recipientDevice: receiverId, msgId },
      new Uint8Array(24).fill(4),
    );
    const id = new TextEncoder().encode(msgId);
    const frame = new Uint8Array(1 + id.length + sealed.length);
    frame[0] = id.length;
    frame.set(id, 1);
    frame.set(sealed, 1 + id.length);
    server.mailbox.push({
      id: 'bad-row',
      group_id: G,
      sender_device_id: senderId,
      recipient_device_id: receiverId,
      ciphertext: `\\x${Buffer.from(bytesToBase64(frame), 'base64').toString('hex')}`,
      created_at: new Date().toISOString(),
    } as never);
    await b.mailbox.fetch();
    expect(JSON.stringify(b.reports)).not.toContain('TENANT-SECRET');
    expect(server.mailbox.some((row) => row.id === 'bad-row')).toBe(false);
    expect((b.store as any).quarantine).toHaveLength(1);
  });

  it('quarantines a bad row while merging valid rows from the same fetched page', async () => {
    const server = new FakeServer();
    server.groups.set(G, [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mB', profileId: 'pB' },
    ]);
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    const [sender, recipient] = await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'valid-row', 'property', { name: 'Valid property' });
    await a.mailbox.flushOutbox();
    server.mailbox.unshift({
      id: 'invalid-row',
      group_id: G,
      sender_device_id: sender,
      recipient_device_id: recipient,
      ciphertext: '\\x00',
      created_at: '2020-01-01T00:00:00.000Z',
    } as never);
    await b.mailbox.sync();
    expect(b.data(G)['valid-row']?.name).toBe('Valid property');
    expect((b.store as any).quarantine).toHaveLength(1);
    expect(server.mailbox).toHaveLength(0);
  });

  it('honors a revoked device status after mailbox recreation', async () => {
    const server = new FakeServer();
    server.groups.set(G, [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mB', profileId: 'pB' },
    ]);
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'r1', 'property', { name: 'Flat' });
    a.setDeviceStatus(false);
    await a.mailbox.flushOutbox();
    a.recreateMailbox();
    await a.mailbox.flushOutbox();
    expect(server.mailbox).toHaveLength(0);
    expect(a.store.outbox).toHaveLength(1);
  });

  it('durably buffers a pre-create edit and converges when the authenticated create arrives', async () => {
    const server = new FakeServer();
    server.groups.set(G, [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mB', profileId: 'pB' },
      { memberId: 'mC', profileId: 'pC' },
    ]);
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    const c = phone(server, 'pC', 'mC', 3);
    await Promise.all([a.deviceId(), b.deviceId(), c.deviceId()]);
    await a.set(G, 'shared-property', 'property', { name: 'Flat' });
    await a.mailbox.flushOutbox();
    const cId = await c.deviceId();
    const heldCreate = server.mailbox.filter((row) => row.recipient_device_id === cId);
    server.mailbox = server.mailbox.filter((row) => row.recipient_device_id !== cId);
    await b.mailbox.sync();
    await b.set(G, 'shared-property', 'property', { name: 'Flat', address: 'Main Road' });
    await b.mailbox.flushOutbox();
    await c.mailbox.sync(); // receives B's edit before A's create
    expect(c.data(G)).toEqual({});
    expect([...c.store.records.values()].some((row) => row.id.startsWith('__meta:pending'))).toBe(
      true,
    );
    await c.space.load(); // the pending edit must survive a process restart
    server.mailbox.push(...heldCreate);
    await c.mailbox.sync();
    expect(c.data(G)['shared-property']).toMatchObject({ name: 'Flat', address: 'Main Road' });
  });

  it('converges across three phones when create is delivered before the edit', async () => {
    const server = new FakeServer();
    server.groups.set(G, [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mB', profileId: 'pB' },
      { memberId: 'mC', profileId: 'pC' },
    ]);
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    const c = phone(server, 'pC', 'mC', 3);
    await Promise.all([a.deviceId(), b.deviceId(), c.deviceId()]);
    await a.set(G, 'shared-property', 'property', { name: 'Flat' });
    await a.mailbox.flushOutbox();
    await Promise.all([b.mailbox.sync(), c.mailbox.sync()]);
    await b.set(G, 'shared-property', 'property', { name: 'Flat', address: 'Main Road' });
    await b.mailbox.flushOutbox();
    await Promise.all([a.mailbox.sync(), c.mailbox.sync()]);
    expect(a.data(G)['shared-property']).toMatchObject({ name: 'Flat', address: 'Main Road' });
    expect(b.data(G)).toEqual(a.data(G));
    expect(c.data(G)).toEqual(a.data(G));
  });

  it('retains the final failed snapshot chunk in the outbox until the server accepts it', async () => {
    const server = new FakeServer();
    server.groups.set(G, [
      { memberId: 'mA', profileId: 'pA' },
      { memberId: 'mB', profileId: 'pB' },
    ]);
    const a = phone(server, 'pA', 'mA', 1);
    const b = phone(server, 'pB', 'mB', 2);
    await Promise.all([a.deviceId(), b.deviceId()]);
    for (let i = 0; i < 12; i++)
      await a.set(G, `property-${i}`, 'property', { name: `Flat ${i}`, notes: 'x'.repeat(7_800) });
    const chunks = e2ee.chunkSnapshot(a.space.snapshot(G), 'x'.repeat(160));
    expect(chunks.length).toBeGreaterThan(1);
    await a.space.queue(G, [{ op: 'resync_req' }]);
    await a.mailbox.flushOutbox();
    server.failAtSendAttempt = server.sendAttempts + chunks.length;
    await b.mailbox.sync();
    expect(b.store.outbox.size).toBe(1);
    const beforeRetry = server.mailbox.length;
    b.clock.t += 60 * 60 * 1000;
    await b.mailbox.flushOutbox();
    expect(b.store.outbox.size).toBe(0);
    expect(server.mailbox.length).toBe(beforeRetry + 1);
  });
});
