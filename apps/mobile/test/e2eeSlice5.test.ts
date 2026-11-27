import { describe, expect, it, vi } from 'vitest';

import { buildBody, parseBody } from '../src/lib/backup/payload';
import { shouldPromptCoupleBackup } from '../src/lib/backup/couplePrompt';
import { snapshotOps } from '../src/e2ee/space';
import { FakeServer, phone } from './e2eeFake';

vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-crypto', () => ({}));

const G = 'group-1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const prop = { name: 'Flat 4', currency: 'INR', status: 'active' };

function world() {
  const server = new FakeServer();
  server.groups.set(G, [
    { memberId: 'mA', profileId: 'pA' },
    { memberId: 'mB', profileId: 'pB' },
  ]);
  return server;
}

/** A has two records and has told B1; B2 is a brand new, empty phone of B. */
async function setup() {
  const server = world();
  const clock = { t: 1_700_000_000_000 };
  const a = phone(server, 'pA', 'mA', 1, clock, [G]);
  const b1 = phone(server, 'pB', 'mB', 2, clock, [G]);
  await Promise.all([a.deviceId(), b1.deviceId()]);
  await a.set(G, 'p1', 'property', prop);
  await a.set(G, 'p2', 'property', { ...prop, name: 'Shop' });
  await a.sync();
  await b1.sync();
  const b2 = phone(server, 'pB', 'mB', 3, clock, [G]);
  await b2.deviceId();
  return { server, clock, a, b1, b2 };
}

describe('resync', () => {
  it('an empty new phone asks, any online device answers, and it converges', async () => {
    const { server, clock, a, b1, b2 } = await setup();
    clock.t += 61_000; // past the device-list cache
    await b2.sync(); // empty group: asks
    await a.sync(); // answers with snapshot chunks
    await b1.sync(); // also got the request; answers too (rate limit is per requester)
    await b2.sync();
    expect(b2.data(G)).toEqual(a.data(G));
    expect(Object.keys(b2.data(G))).toEqual(['p1', 'p2']);
    // Everything fetched was deleted from the server.
    await b1.sync();
    await a.sync();
    await b2.sync();
    expect(server.mailbox).toHaveLength(0);
  });

  it('a snapshot never reaches the requester twice within the hour, and does again after it', async () => {
    const { server, clock, a, b2 } = await setup();
    clock.t += 61_000;
    await b2.sync();
    await a.sync();
    const aId = await a.deviceId();
    const fromA = () => server.sends.filter((x) => x.sender === aId).length;
    const sent = fromA();
    expect(sent).toBeGreaterThan(0);
    await b2.mailbox.requestResync(G);
    await b2.mailbox.flushOutbox();
    await a.sync(); // too soon: ignored
    expect(fromA()).toBe(sent);
    clock.t += HOUR + 1;
    await b2.mailbox.requestResync(G);
    await b2.mailbox.flushOutbox();
    await a.sync();
    expect(fromA()).toBeGreaterThan(sent);
  });

  it('asks again when the phone has been away over 30 days, not before', async () => {
    const { server, clock, a } = await setup();
    clock.t += 61_000;
    await a.sync(); // first fetch on this install: may ask once
    const base = server.sends.length;
    clock.t += 2 * HOUR;
    await a.sync();
    expect(server.sends.length).toBe(base);
    clock.t += 31 * DAY;
    await a.sync();
    expect(server.sends.length).toBe(base + 1);
  });
});

describe('leaving', () => {
  it('keeps a read-only copy on the phone, and stops sending and receiving', async () => {
    const { server, clock, a, b1 } = await setup();
    const g = 'former:' + G;
    await b1.set(G, 'p3', 'property', { ...prop, name: 'Unsent' }); // sits in the outbox? sent below
    await b1.space.retire(G, 'Asha');
    expect(b1.space.records(G)).toHaveLength(0);
    expect(b1.space.formerGroups()).toEqual([{ groupId: g, name: 'Asha' }]);
    expect(b1.space.records(g).map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
    // On disk: re-tagged, nothing left under the live group, outbox emptied.
    const keys = [...b1.store.records.values()].map((r) => r.groupId);
    expect(keys.every((k) => k === g)).toBe(true);
    expect(b1.store.outbox.size).toBe(0);

    // The group leaves b1's mirror (groups: []) and a keeps writing: nothing lands.
    server.groups.set(G, [{ memberId: 'mA', profileId: 'pA' }]);
    clock.t += 61_000;
    await a.set(G, 'p9', 'property', prop);
    b1.groups.length = 0;
    await b1.sync();
    expect(b1.space.records(g).map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
    expect(b1.space.records(G)).toHaveLength(0);
    // A read-only copy refuses edits.
    await expect(b1.set(g, 'x', 'property', prop)).rejects.toThrow();
    // It survives a reload.
    await b1.space.load();
    expect(b1.space.formerGroups()).toHaveLength(1);
    // The partner who stays keeps everything.
    expect(Object.keys(a.data(G))).toContain('p1');
  });
});

describe('new phone notice', () => {
  it('shows once per new partner device, never for my own phone or a first device', async () => {
    const server = world();
    const clock = { t: 1_700_000_000_000 };
    const a = phone(server, 'pA', 'mA', 1, clock, [G]);
    await a.deviceId();
    await a.sync(); // baseline: B has no phone yet
    const b1 = phone(server, 'pB', 'mB', 2, clock, [G]);
    await b1.deviceId();
    clock.t += 61_000;
    await a.sync();
    expect(a.mailbox.notices.list()).toEqual([]); // B's first phone is not "a new phone"

    const b2 = phone(server, 'pB', 'mB', 3, clock, [G]);
    const b2Id = await b2.deviceId();
    clock.t += 61_000;
    await a.sync();
    await a.sync();
    expect(a.mailbox.notices.list()).toMatchObject([
      { groupId: G, memberId: 'mB', deviceId: b2Id },
    ]);

    const a2 = phone(server, 'pA', 'mA', 4, clock, [G]);
    await a2.deviceId();
    clock.t += 61_000;
    await a.sync();
    expect(a.mailbox.notices.list()).toHaveLength(1); // my own other phone: no notice

    // The partner removing a phone is shown too.
    server.devices = server.devices.filter((d) => d.id !== b2Id);
    clock.t += 61_000;
    await a.sync();
    expect(a.mailbox.notices.list().filter((n) => n.removed)).toHaveLength(1);

    a.mailbox.notices.dismiss(a.mailbox.notices.list()[0]!.deviceId);
    clock.t += 61_000;
    await a.sync();
    await Promise.all(a.mailbox.notices.list().map((n) => a.mailbox.notices.dismiss(n.deviceId)));
    expect(a.mailbox.notices.list()).toEqual([]);
  });
});

describe('backup of couple data', () => {
  it('restoring an older snapshot cannot erase a newer tombstone in a former copy', async () => {
    const { server } = await setup();
    const c = phone(server, 'pA', 'mA', 21, { t: 1_700_000_000_000 }, []);
    await c.space.applyIncoming([
      {
        groupId: 'former:' + G,
        senderMemberId: 'mA',
        trusted: true,
        ops: [
          {
            op: 'put',
            id: 'x',
            kind: 'property',
            createdBy: 'mA',
            create: true,
            fields: { name: ['Old', '1:0:A'] },
          },
        ],
      },
    ]);
    const old = c.space.backupCouple(() => 'Home');
    await c.space.applyIncoming([
      {
        groupId: 'former:' + G,
        senderMemberId: 'mA',
        trusted: true,
        ops: [{ op: 'del', id: 'x', hlc: '5:0:A' }],
      },
    ]);
    await c.space.restoreCouple(old, []);
    expect(c.space.records('former:' + G)).toHaveLength(0);
  });

  it('merges former-only backup history after rejoining an empty live store', async () => {
    const { server } = await setup();
    const oldPhone = phone(server, 'pA', 'mA', 22, { t: 1_700_000_000_000 }, []);
    await oldPhone.space.applyIncoming([
      {
        groupId: 'former:' + G,
        senderMemberId: 'mA',
        trusted: true,
        ops: [
          {
            op: 'put',
            id: 'history',
            kind: 'property',
            createdBy: 'mA',
            create: true,
            fields: { name: ['History', '1:0:A'] },
          },
        ],
      },
    ]);
    const former = oldPhone.space.backupCouple(() => 'Home');
    const rejoined = phone(server, 'pA', 'mA', 23, { t: 1_700_000_000_000 }, []);
    await rejoined.space.restoreCouple(former, [G]);
    expect(rejoined.space.records(G).map((r) => r.id)).toContain('history');
  });

  it('round-trips through the backup body and restores into the e2ee tables only', async () => {
    const { server, a } = await setup();
    const couple = a.space.backupCouple(() => 'Home');
    const body = buildBody('owner', [], new Date('2027-01-01'), couple);
    const back = parseBody(JSON.stringify(body), 'owner');
    expect(back.couple).toEqual(couple);

    const c = phone(server, 'pA', 'mA', 7, { t: 1_700_000_000_000 }, [G]);
    await c.space.restoreCouple(back.couple ?? [], [G]);
    expect(c.data(G)).toEqual(a.data(G));
    expect(c.store.records.size).toBeGreaterThan(0);
    expect(c.store.outbox.size).toBe(0); // restore never queues anything to send

    // A group the account has since left comes back as a read-only former couple.
    const d = phone(server, 'pA', 'mA', 8, { t: 1_700_000_000_000 }, []);
    await d.space.restoreCouple(back.couple ?? [], []);
    expect(d.space.formerGroups()).toEqual([{ groupId: 'former:' + G, name: 'Home' }]);
  });

  it('an old backup without couple data still parses', () => {
    const back = parseBody(JSON.stringify(buildBody('o', [], new Date())), 'o');
    expect(back.couple ?? []).toEqual([]);
  });
});

describe('sign-out back-up prompt', () => {
  const now = 1_700_000_000_000;
  it('asks only with couple data and no recent backup', () => {
    expect(shouldPromptCoupleBackup({ coupleRecords: 0, lastBackupAt: null, now })).toBe(false);
    expect(
      shouldPromptCoupleBackup({ coupleRecords: 0, lastBackupAt: now, now, outboxCount: 1 }),
    ).toBe(true);
    expect(
      shouldPromptCoupleBackup({ coupleRecords: 0, lastBackupAt: null, now, formerRecords: 1 }),
    ).toBe(true);
    expect(
      shouldPromptCoupleBackup({ coupleRecords: 0, lastBackupAt: now, now, formerRecords: 1 }),
    ).toBe(false);
    expect(shouldPromptCoupleBackup({ coupleRecords: 3, lastBackupAt: null, now })).toBe(true);
    expect(shouldPromptCoupleBackup({ coupleRecords: 3, lastBackupAt: now - 2 * DAY, now })).toBe(
      false,
    );
    expect(
      shouldPromptCoupleBackup({
        coupleRecords: 3,
        lastBackupAt: now - 2 * DAY,
        now,
        outboxCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldPromptCoupleBackup({
        coupleRecords: 3,
        lastBackupAt: now - 2 * DAY,
        now,
        lastLocalChangeAt: now - DAY,
      }),
    ).toBe(true);
    expect(
      shouldPromptCoupleBackup({
        coupleRecords: 3,
        lastBackupAt: now - 2 * DAY,
        now,
        lastLocalChangeAt: now - 3 * DAY,
      }),
    ).toBe(false);
    expect(shouldPromptCoupleBackup({ coupleRecords: 3, lastBackupAt: now - 10 * DAY, now })).toBe(
      true,
    );
  });

  it('warns when the last live record was deleted after backup', () => {
    expect(
      shouldPromptCoupleBackup({
        coupleRecords: 0,
        lastBackupAt: now - DAY,
        now,
        lastLocalChangeAt: now,
      }),
    ).toBe(true);
  });
});

describe('snapshot trust', () => {
  const forged = (createdBy: string) => ({
    id: 'f1',
    kind: 'property',
    createdBy,
    fields: { name: ['Forged', '9999999999999:0:ckA'] },
  });

  it('an unsolicited snapshot cannot plant a record authored by someone else', async () => {
    const { server, clock, a, b1 } = await setup();
    clock.t += 25 * HOUR; // any earlier request of b1's has expired
    const bId = await b1.deviceId();
    await a.space.queue(
      G,
      [{ op: 'snapshot', part: 0, of: 1, to: bId, records: [forged('mB')] }],
      bId,
    );
    await a.mailbox.flushOutbox();
    expect(server.mailbox.length).toBeGreaterThan(0);
    await b1.sync();
    expect(b1.data(G)).not.toHaveProperty('f1');
    // A late duplicate answer is normal, not an error to show anyone.
    expect(b1.reports.map((r) => r.where)).not.toContain('e2ee.snapshot');
  });

  it('a snapshot addressed to another device is ignored', async () => {
    const { clock, a, b2 } = await setup();
    clock.t += 61_000;
    await b2.sync(); // asks, so a snapshot would be trusted
    const b2Id = await b2.deviceId();
    await a.space.queue(
      G,
      [{ op: 'snapshot', part: 0, of: 1, to: await a.deviceId(), records: [forged('mA')] }],
      b2Id,
    );
    await a.mailbox.flushOutbox();
    await b2.sync();
    expect(b2.data(G)).not.toHaveProperty('f1');
  });

  it('a snapshot can never change the author of a record the phone already has', async () => {
    const { a } = await setup();
    const p1 = a.space.snapshot(G).find((r) => r.id === 'p1')!;
    const early = { ...p1, createdBy: 'mX', fields: { name: ['Early', '1:0:ckZ'] as const } };
    await a.space.applyIncoming([
      { groupId: G, ops: snapshotOps([early]), senderMemberId: 'mB', trusted: true },
    ]);
    expect(a.space.records(G).find((r) => r.id === 'p1')!.created_by).toBe('mA');
  });
});

describe('former restore merge', () => {
  it('merges a newer backup into an existing former copy, keeping both histories', async () => {
    const { server, a } = await setup();
    const older = a.space.backupCouple(() => 'Home');
    await a.set(G, 'p3', 'property', { ...prop, name: 'Garage' });
    const newer = a.space.backupCouple(() => 'Home');
    const c = phone(server, 'pA', 'mA', 9, { t: 1_700_000_000_000 }, []);
    await c.space.restoreCouple(older, []);
    expect(c.space.records('former:' + G).map((r) => r.id)).toEqual(['p1', 'p2']);
    await c.space.restoreCouple(newer, []);
    expect(c.space.records('former:' + G).map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('snapshot creation clocks', () => {
  it('preserves createdHlc on snapshot puts', async () => {
    const rec = {
      id: 'x',
      kind: 'property',
      createdBy: 'mA',
      createdHlc: '1700000000000:0:ckA',
      fields: { name: ['Flat', '1700000000000:0:ckA'] },
    };
    expect(snapshotOps([rec as never])[0]).toMatchObject({
      op: 'put',
      create: true,
      createdHlc: rec.createdHlc,
    });
  });
});
