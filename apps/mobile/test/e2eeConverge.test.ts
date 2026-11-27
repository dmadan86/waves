import { describe, expect, it, vi } from 'vitest';

import { recurringOccurrenceId } from '@waves/core';

import { FakeServer, phone } from './e2eeFake';

vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-crypto', () => ({}));

const G = 'group-1';

function couple() {
  const server = new FakeServer();
  server.groups.set(G, [
    { memberId: 'mA', profileId: 'pA' },
    { memberId: 'mB', profileId: 'pB' },
  ]);
  const clock = { t: 1_700_000_000_000 };
  const a = phone(server, 'pA', 'mA', 1, clock);
  const b = phone(server, 'pB', 'mB', 2, clock);
  const tick = () => (clock.t += 1000);
  /** Two rounds so each side has heard the other's reply. */
  const settle = async () => {
    for (let i = 0; i < 2; i++) {
      await a.sync();
      await b.sync();
    }
  };
  return { server, a, b, tick, settle };
}

describe('two phones converge through the mailbox', () => {
  it('put, edit, delete', async () => {
    const { a, b, tick, settle } = couple();
    await Promise.all([a.deviceId(), b.deviceId()]);

    await a.set(G, 'p1', 'property', { name: 'Flat 4', status: 'active', address: 'MG Road' });
    await settle();
    expect(b.data(G).p1).toMatchObject({ name: 'Flat 4', address: 'MG Road' });
    expect(b.space.records(G)[0]!.created_by).toBe('mA');

    tick();
    await b.set(G, 'p1', 'property', { name: 'Flat 4B', status: 'active', address: 'MG Road' });
    await settle();
    expect(a.data(G).p1).toMatchObject({ name: 'Flat 4B', address: 'MG Road' });

    tick();
    await a.set(G, 'p1', 'property', { name: 'Flat 4B', status: 'active' }); // address cleared
    await settle();
    expect(b.data(G).p1!.address).toBeNull();

    tick();
    await b.del(G, 'p1');
    await settle();
    expect(a.data(G)).toEqual({});
    expect(b.data(G)).toEqual({});
  });

  it('different fields edited at once both survive; the same field settles on one value', async () => {
    const { a, b, tick, settle } = couple();
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'tn', 'tenancy', { tenantName: 'Ravi', tenantPhone: '1', note: '' });
    await settle();

    tick();
    await a.set(G, 'tn', 'tenancy', { tenantName: 'Ravi K', tenantPhone: '1', note: '' });
    await b.set(G, 'tn', 'tenancy', { tenantName: 'Ravi', tenantPhone: '2', note: 'late' });
    await settle();
    expect(a.data(G).tn).toEqual(b.data(G).tn);
    expect(a.data(G).tn).toMatchObject({ tenantName: 'Ravi K', tenantPhone: '2', note: 'late' });

    // Same field, same instant: the larger hlc wins on both phones.
    await a.set(G, 'tn', 'tenancy', { tenantName: 'X', tenantPhone: '2', note: 'late' });
    await b.set(G, 'tn', 'tenancy', { tenantName: 'Y', tenantPhone: '2', note: 'late' });
    await settle();
    expect(a.data(G).tn).toEqual(b.data(G).tn);
  });

  it('both tapping "paid in full" offline converge, createdBy included, and edits cross over', async () => {
    for (const order of ['ab', 'ba']) {
      const { a, b, tick, settle } = couple();
      await Promise.all([a.deviceId(), b.deviceId()]);
      const id = recurringOccurrenceId('rule-1', '2027-01-05');
      const base = { kind: 'income', category: 'inc.rent', date: '2027-01-05' };
      const first = order === 'ab' ? a : b;
      const second = order === 'ab' ? b : a;
      await first.set(G, id, 'txn', { ...base, amount: '25000', note: 'first' });
      tick();
      await second.set(G, id, 'txn', { ...base, amount: '24000', note: 'second' });
      await settle();
      expect(a.space.records(G)).toHaveLength(1);
      expect(a.data(G)).toEqual(b.data(G));
      const by = a.space.records(G)[0]!.created_by;
      expect(b.space.records(G)[0]!.created_by).toBe(by);
      expect(by).toBe(first.me.memberId); // the earliest creation wins

      tick();
      await a.set(G, id, 'txn', { ...a.data(G)[id]!, note: 'from A' });
      await settle();
      expect(b.data(G)[id]!.note).toBe('from A');
      tick();
      await b.set(G, id, 'txn', { ...b.data(G)[id]!, amount: '1' });
      await settle();
      expect(a.data(G)[id]!.amount).toBe('1');
      expect(a.data(G)).toEqual(b.data(G));
    }
  });

  it('a delete is not undone by a late edit from the other phone', async () => {
    const { a, b, tick, settle } = couple();
    await Promise.all([a.deviceId(), b.deviceId()]);
    await a.set(G, 'p1', 'property', { name: 'Flat', status: 'active' });
    await settle();
    tick();
    await b.set(G, 'p1', 'property', { name: 'Flat 2', status: 'active' }); // offline edit
    tick();
    await a.del(G, 'p1');
    await settle();
    expect(a.data(G)).toEqual(b.data(G));
  });

  it('survives a restart: records reload from the store and the outbox still sends', async () => {
    const { a, b, server } = couple();
    await Promise.all([a.deviceId(), b.deviceId()]);
    server.failSends = 1;
    await a.set(G, 'p1', 'property', { name: 'Flat', status: 'active' });
    await a.mailbox.flushOutbox().catch(() => undefined);
    // "Relaunch": a fresh space over the same store.
    const again = phone(server, 'pA', 'mA', 1);
    again.store.records = a.store.records;
    again.store.outbox = a.store.outbox;
    await again.space.load();
    expect(again.data(G).p1).toMatchObject({ name: 'Flat' });
    await again.mailbox.flushOutbox();
    await b.sync();
    expect(b.data(G).p1).toMatchObject({ name: 'Flat' });
  });
});
