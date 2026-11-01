import { describe, expect, it } from 'vitest';
import {
  clientCounts,
  clientsToReceive,
  emptyMirror,
  filterClients,
  groupFollowUps,
  materialiseClients,
  materialiseWorkTasks,
  nextFollowUpDay,
  reconcile,
  SyncTable,
  type CompanyClient,
  type QueuedMutation,
  type SyncChange,
} from '../src';

const client = (over: Partial<CompanyClient>): CompanyClient => ({
  id: 'c',
  name: 'Ramesh',
  phone: null,
  need: null,
  source: 'other',
  expectedValueMinor: null,
  address: null,
  stage: 'inquiry',
  lostReason: null,
  ownerMemberId: null,
  createdBy: 'm',
  createdAt: '2026-11-01T00:00:00Z',
  ...over,
});

describe('client list', () => {
  const all = [
    client({ id: '1', name: 'Asha', stage: 'inquiry', need: 'Painting', createdAt: '2026-11-03' }),
    client({ id: '2', name: 'Bala', stage: 'quoted', createdAt: '2026-11-02' }),
    client({ id: '3', name: 'Chitra', stage: 'client', phone: '99001' }),
    client({ id: '4', name: 'Dev', stage: 'lost' }),
  ];
  it('counts per stage; All leaves lost out', () => {
    expect(clientCounts(all)).toEqual({ all: 3, inquiry: 1, quoted: 1, client: 1, lost: 1 });
  });
  it('filters by chip and searches name, phone and need, newest first', () => {
    expect(filterClients(all, 'all').map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(filterClients(all, 'lost').map((c) => c.id)).toEqual(['4']);
    expect(filterClients(all, 'all', 'paint').map((c) => c.id)).toEqual(['1']);
    expect(filterClients(all, 'client', '990').map((c) => c.id)).toEqual(['3']);
  });
});

describe('to receive', () => {
  const bill = (clientId: string | null, total: bigint, paid: bigint, deleted = false) => ({
    docType: 'bill' as const,
    status: 'unpaid' as const,
    totalMinor: total,
    paidMinor: paid,
    clientId,
    deleted,
  });
  it('sums unpaid bill balances per client and overall', () => {
    const r = clientsToReceive([
      bill('a', 1000n, 400n),
      bill('a', 500n, 0n),
      bill('b', 700n, 700n),
      bill(null, 900n, 0n),
      bill('b', 100n, 0n, true),
      { ...bill('b', 300n, 0n), docType: 'estimate' as const },
    ]);
    expect(r.byClient.get('a')).toBe(1100n);
    expect(r.byClient.has('b')).toBe(false);
    expect(r.total).toBe(1100n);
  });
});

describe('follow-up grouping', () => {
  const t = (
    id: string,
    day: string,
    status: 'todo' | 'done' | 'doing' = 'todo',
    clientId: string | null = 'c',
    dueTime: string | null = null,
  ) => ({ id, day, status, clientId, dueTime });
  it('groups open client tasks as overdue, today, this week and later', () => {
    const g = groupFollowUps(
      [
        t('late', '2026-11-08'),
        t('now-pm', '2026-11-10', 'todo', 'c', '15:00'),
        t('now-am', '2026-11-10', 'doing', 'c', '09:00'),
        t('wk', '2026-11-17'),
        t('far', '2026-11-18'),
        t('done', '2026-11-10', 'done'),
        t('plain', '2026-11-10', 'todo', null),
      ],
      '2026-11-10',
    );
    expect(g.overdue.map((x) => x.id)).toEqual(['late']);
    expect(g.today.map((x) => x.id)).toEqual(['now-am', 'now-pm']);
    expect(g.week.map((x) => x.id)).toEqual(['wk']);
    expect(g.later.map((x) => x.id)).toEqual(['far']);
  });
  it('picks the next follow-up day', () => {
    expect(nextFollowUpDay('tomorrow', '2026-11-30')).toBe('2026-12-01');
    expect(nextFollowUpDay('next_week', '2026-11-10')).toBe('2026-11-17');
    expect(nextFollowUpDay('none', '2026-11-10')).toBeNull();
  });
});

describe('materialise clients and follow-up links', () => {
  let seq = 0;
  const row = (table: SyncTable, r: Record<string, unknown>): SyncChange => ({
    table,
    groupId: 'g',
    seq: ++seq,
    row: { group_id: 'g', deleted_at: null, ...r },
  });
  const q = (kind: string, payload: Record<string, unknown>, n: number): QueuedMutation =>
    ({
      clientMutationId: `m${n}`,
      kind,
      groupId: 'g',
      clientCreatedAt: '2026-11-11T00:00:00Z',
      payload,
      seq: n,
      attempts: 0,
      nextAttemptAt: 0,
    }) as unknown as QueuedMutation;
  const state = reconcile(emptyMirror(), [
    row(SyncTable.CompanyClients, {
      id: 'c1',
      name: 'Priya',
      source: 'whatsapp',
      stage: 'inquiry',
      expected_value: '8500000',
      created_by: 'm',
      created_at: '2026-11-01T00:00:00Z',
    }),
    row(SyncTable.CompanyClients, {
      id: 'gone',
      name: 'X',
      source: 'call',
      stage: 'lost',
      created_by: 'm',
      deleted_at: 'x',
    }),
    row(SyncTable.CompanyClientNotes, {
      id: 'n1',
      client_id: 'c1',
      body: 'Called',
      created_by: 'm',
      created_at: '2026-11-02',
    }),
    row(SyncTable.CompanyWorkTasks, {
      id: 't1',
      member_id: 'm',
      day: '2026-11-12',
      title: 'Call',
      status: 'todo',
      client_id: 'c1',
      created_at: 'x',
    }),
  ]).state;

  it('reads rows and applies queued set, note and remove', () => {
    const base = materialiseClients(state, [], { groupId: 'g' });
    expect(base.clients.map((c) => c.id)).toEqual(['c1']);
    expect(base.clients[0]!.expectedValueMinor).toBe(8500000n);
    const next = materialiseClients(
      state,
      [
        q(
          'company_client.set',
          {
            clientId: 'c1',
            name: 'Priya S',
            phone: null,
            need: null,
            source: 'whatsapp',
            expectedValueMinor: null,
            address: null,
            stage: 'quoted',
            lostReason: 'ignored',
            ownerMemberId: null,
          },
          1,
        ),
        q('company_client_note.add', { noteId: 'n2', clientId: 'c1', body: 'Sent estimate' }, 2),
      ],
      { groupId: 'g' },
    );
    expect(next.clients[0]).toMatchObject({
      name: 'Priya S',
      stage: 'quoted',
      lostReason: null,
      pending: true,
    });
    expect(next.notes.map((n) => n.id)).toEqual(['n1', 'n2']);
    const removed = materialiseClients(state, [q('company_client.remove', { clientId: 'c1' }, 1)], {
      groupId: 'g',
    });
    expect(removed.clients).toEqual([]);
  });

  it('a task keeps its client unless a queued edit names one', () => {
    const set = (extra: Record<string, unknown>) =>
      q(
        'company_work.set',
        {
          taskId: 't1',
          memberId: 'm',
          day: '2026-11-12',
          title: 'Call',
          projectId: null,
          status: 'done',
          blockedReason: null,
          note: null,
          ...extra,
        },
        1,
      );
    expect(materialiseWorkTasks(state, [], { groupId: 'g' })[0]!.clientId).toBe('c1');
    expect(materialiseWorkTasks(state, [set({})], { groupId: 'g' })[0]!.clientId).toBe('c1');
    expect(
      materialiseWorkTasks(state, [set({ clientId: null })], { groupId: 'g' })[0]!.clientId,
    ).toBeNull();
    const fresh = materialiseWorkTasks(state, [set({ taskId: 't2', clientId: 'c1' })], {
      groupId: 'g',
    });
    expect(fresh.find((x) => x.id === 't2')!.clientId).toBe('c1');
  });
});
