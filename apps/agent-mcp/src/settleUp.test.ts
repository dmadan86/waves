/**
 * Settling up, the way people ask about it.
 *
 * "Who should pay whom?", "did I already record paying Matt?", "Matt paid me
 * ₹100 in cash", "what did you change today?" — each of these used to take an
 * agent three calls and a join it had to do in its head. The answers here are
 * what somebody pays on, so a transfer pointing the wrong way, a name matched
 * to the wrong member, or a settlement recorded against a person who is not
 * in the group are the failures that matter.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { pairwiseTransfers, simplifyNet } from './settle';
import { buildWavesServer } from './tools';

const ME = 'profile-me';
const GROUP = '7473b904-c06b-490b-97b5-12e4b166db8b';
const M_ME = '11111111-1111-4111-8111-111111111111';
const M_MATT = '22222222-2222-4222-8222-222222222222';
const M_RAJ = '33333333-3333-4333-8333-333333333333';

const MEMBERS = [
  { id: M_ME, profile_id: ME, ghost_name: null, profile: { display_name: 'Madan' } },
  {
    id: M_MATT,
    profile_id: null,
    ghost_name: 'Matt Hardy',
    vpa: 'matt@okbank',
    profile: null,
  },
  { id: M_RAJ, profile_id: null, ghost_name: 'Raj', profile: null },
];

type Filter = [method: string, ...args: unknown[]];
type Answer = { data?: unknown; error?: { message: string } | null };

/** Each table and RPC answers with a canned result; every filter and RPC is kept. */
function fake(answers: Record<string, Answer>) {
  const queries: { table: string; filters: Filter[] }[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const filters: Filter[] = [];
      queries.push({ table, filters });
      const answer = answers[table] ?? { data: table === 'group_members' ? MEMBERS : [] };
      const result = { data: answer.data ?? null, error: answer.error ?? null };
      const query: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
        single: async () => result,
      };
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
        query[m] = (...args: unknown[]) => {
          filters.push([m, ...args]);
          return query;
        };
      }
      return query;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      const answer = answers[`rpc:${fn}`] ?? { data: 'settlement-1' };
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as unknown as SupabaseClient;
  return { client, queries, rpcs };
}

async function call(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; text: string; json: any }> {
  const server = buildWavesServer(supabase, ME, false);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  const text = (result.content as { text: string }[])[0]?.text ?? '';
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* an error message */
  }
  return { isError: Boolean(result.isError), text, json };
}

describe('simplifying balances', () => {
  it('settles three people in two payments, largest debtor to largest creditor', () => {
    const transfers = simplifyNet([
      { member_id: 'a', currency: 'INR', balance: '900' },
      { member_id: 'b', currency: 'INR', balance: '-600' },
      { member_id: 'c', currency: 'INR', balance: '-300' },
    ]);
    expect(transfers).toEqual([
      { from: 'b', to: 'a', currency: 'INR', amount: 600n },
      { from: 'c', to: 'a', currency: 'INR', amount: 300n },
    ]);
  });

  it('keeps currencies apart, and never nets rupees against dollars', () => {
    const transfers = simplifyNet([
      { member_id: 'a', currency: 'USD', balance: 50 },
      { member_id: 'b', currency: 'USD', balance: -50 },
      { member_id: 'a', currency: 'INR', balance: -700 },
      { member_id: 'b', currency: 'INR', balance: 700 },
    ]);
    expect(transfers).toEqual([
      { from: 'a', to: 'b', currency: 'INR', amount: 700n },
      { from: 'b', to: 'a', currency: 'USD', amount: 50n },
    ]);
  });

  it('proposes nothing for a settled group', () => {
    expect(simplifyNet([{ member_id: 'a', currency: 'INR', balance: 0 }])).toEqual([]);
  });

  it('reads the real pairwise debts, dropping the edges already at zero', () => {
    expect(
      pairwiseTransfers([
        { from_member_id: 'b', to_member_id: 'a', currency: 'INR', amount: '100' },
        { from_member_id: 'c', to_member_id: 'a', currency: 'INR', amount: '0' },
        { from_member_id: 'c', to_member_id: 'b', currency: 'INR', amount: '400' },
      ]),
    ).toEqual([
      { from: 'c', to: 'b', currency: 'INR', amount: 400n },
      { from: 'b', to: 'a', currency: 'INR', amount: 100n },
    ]);
  });
});

describe('"Who should pay whom to settle Goa?"', () => {
  it('names both sides and says how to pay the payee, when debts are simplified', async () => {
    const { client, queries } = fake({
      groups: { data: { simplify_debts: true } },
      group_balances: {
        data: [
          { member_id: M_ME, currency: 'INR', balance: -10000 },
          { member_id: M_MATT, currency: 'INR', balance: 10000 },
        ],
      },
    });
    const { json } = await call(client, 'settlement_plan', { groupId: GROUP });

    expect(json).toMatchObject({
      simplified: true,
      settled: false,
      transfers: [
        {
          from: { memberId: M_ME, name: 'Madan', isYou: true },
          to: {
            memberId: M_MATT,
            name: 'Matt Hardy',
            isYou: false,
            rail: 'upi',
            handle: 'matt@okbank',
          },
          amount: '10000',
          currency: 'INR',
        },
      ],
      pending: [],
    });
    expect(queries.map((q) => q.table)).not.toContain('pairwise_balances');
  });

  it('follows the real debts when the group has simplifying turned off', async () => {
    const { client, queries } = fake({
      groups: { data: { simplify_debts: false } },
      pairwise_balances: {
        data: [{ from_member_id: M_RAJ, to_member_id: M_ME, currency: 'INR', amount: '5000' }],
      },
    });
    const { json } = await call(client, 'settlement_plan', { groupId: GROUP });

    expect(json.simplified).toBe(false);
    expect(json.transfers).toHaveLength(1);
    expect(json.transfers[0]).toMatchObject({
      from: { name: 'Raj' },
      to: { name: 'Madan', isYou: true },
      amount: '5000',
    });
    expect(queries.find((q) => q.table === 'pairwise_balances')!.filters).toContainEqual([
      'eq',
      'group_id',
      GROUP,
    ]);
  });

  it('shows a payment already recorded but not confirmed, so nobody pays twice', async () => {
    const { client, queries } = fake({
      groups: { data: { simplify_debts: true } },
      group_balances: {
        data: [
          { member_id: M_ME, currency: 'INR', balance: -10000 },
          { member_id: M_MATT, currency: 'INR', balance: 10000 },
        ],
      },
      settlements: {
        data: [
          {
            id: 's-1',
            from_member_id: M_ME,
            to_member_id: M_MATT,
            amount: 10000,
            currency: 'INR',
            method: 'upi',
            rail: 'upi',
            status: 'initiated',
            note: null,
            initiated_at: '2026-09-25T10:00:00Z',
            confirmed_at: null,
          },
        ],
      },
    });
    const { json } = await call(client, 'settlement_plan', { groupId: GROUP });

    expect(json.pending).toEqual([
      expect.objectContaining({
        settlementId: 's-1',
        from: { memberId: M_ME, name: 'Madan', isYou: true },
        to: { memberId: M_MATT, name: 'Matt Hardy', isYou: false },
        status: 'initiated',
      }),
    ]);
    expect(queries.find((q) => q.table === 'settlements')!.filters).toContainEqual([
      'eq',
      'status',
      'initiated',
    ]);
  });

  it('says a group is settled when nothing is owed', async () => {
    const { client } = fake({ groups: { data: { simplify_debts: true } } });
    const { json } = await call(client, 'settlement_plan', { groupId: GROUP });
    expect(json).toMatchObject({ settled: true, transfers: [] });
  });

  it('names a member who has left rather than dropping their debt', async () => {
    const { client } = fake({
      groups: { data: { simplify_debts: true } },
      group_balances: {
        data: [
          { member_id: 'gone', currency: 'INR', balance: -300 },
          { member_id: M_ME, currency: 'INR', balance: 300 },
        ],
      },
    });
    const { json } = await call(client, 'settlement_plan', { groupId: GROUP });
    expect(json.transfers[0].from).toEqual({
      memberId: 'gone',
      name: 'Former member',
      isYou: false,
    });
  });

  it('reports a group it cannot read as an error', async () => {
    const { client } = fake({ groups: { error: { message: 'no rows' } } });
    const { isError } = await call(client, 'settlement_plan', { groupId: GROUP });
    expect(isError).toBe(true);
  });
});

describe('"Did I already record paying Matt?"', () => {
  it('lists settlements newest first, both sides named, scoped to the group', async () => {
    const { client, queries } = fake({
      settlements: {
        data: [
          {
            id: 's-2',
            from_member_id: M_ME,
            to_member_id: M_MATT,
            amount: '2500',
            currency: 'INR',
            method: 'other',
            rail: 'paypal',
            status: 'confirmed',
            note: 'chai',
            initiated_at: '2026-09-24T10:00:00Z',
            confirmed_at: '2026-09-24T11:00:00Z',
          },
        ],
      },
    });
    const { json } = await call(client, 'list_settlements', { groupId: GROUP });

    expect(json).toEqual([
      {
        settlementId: 's-2',
        from: { memberId: M_ME, name: 'Madan', isYou: true },
        to: { memberId: M_MATT, name: 'Matt Hardy', isYou: false },
        amount: '2500',
        currency: 'INR',
        rail: 'paypal',
        status: 'confirmed',
        note: 'chai',
        initiatedAt: '2026-09-24T10:00:00Z',
        confirmedAt: '2026-09-24T11:00:00Z',
      },
    ]);
    const filters = queries.find((q) => q.table === 'settlements')!.filters;
    expect(filters).toContainEqual(['eq', 'group_id', GROUP]);
    expect(filters).toContainEqual(['order', 'initiated_at', { ascending: false }]);
    expect(filters).toContainEqual(['limit', 20]);
    expect(filters.some((f) => f[0] === 'eq' && f[1] === 'status')).toBe(false);
  });

  it('narrows to one state when asked', async () => {
    const { client, queries } = fake({});
    await call(client, 'list_settlements', { groupId: GROUP, status: 'disputed', limit: 5 });
    const filters = queries.find((q) => q.table === 'settlements')!.filters;
    expect(filters).toContainEqual(['eq', 'status', 'disputed']);
    expect(filters).toContainEqual(['limit', 5]);
  });

  it('refuses a state that does not exist', async () => {
    const { client } = fake({});
    const { isError } = await call(client, 'list_settlements', { groupId: GROUP, status: 'paid' });
    expect(isError).toBe(true);
  });
});

describe('"What did you change in Waves today?"', () => {
  it('lists what assistants did, with the group named', async () => {
    const { client, rpcs, queries } = fake({
      'rpc:waves_my_agent_writes': {
        data: [
          {
            id: 'w-1',
            client_id: 'desktop-assistant',
            action: 'expense.delete',
            group_id: GROUP,
            object_id: 'e-1',
            amount_minor: null,
            currency: null,
            created_at: '2026-09-26T09:00:00Z',
          },
          {
            id: 'w-2',
            client_id: 'desktop-assistant',
            action: 'expense.add',
            group_id: GROUP,
            object_id: 'e-1',
            amount_minor: '20000',
            currency: 'INR',
            created_at: '2026-09-26T08:00:00Z',
          },
        ],
      },
      groups: { data: [{ id: GROUP, name: 'Goa' }] },
    });
    const { json } = await call(client, 'list_agent_writes', { limit: 10 });

    expect(rpcs).toEqual([{ fn: 'waves_my_agent_writes', args: { p_limit: 10 } }]);
    expect(json).toEqual([
      {
        at: '2026-09-26T09:00:00Z',
        clientId: 'desktop-assistant',
        action: 'expense.delete',
        groupId: GROUP,
        groupName: 'Goa',
        objectId: 'e-1',
        amount: null,
        currency: null,
      },
      {
        at: '2026-09-26T08:00:00Z',
        clientId: 'desktop-assistant',
        action: 'expense.add',
        groupId: GROUP,
        groupName: 'Goa',
        objectId: 'e-1',
        amount: '20000',
        currency: 'INR',
      },
    ]);
    // One lookup for the group, however many rows name it.
    expect(queries.find((q) => q.table === 'groups')!.filters).toContainEqual([
      'in',
      'id',
      [GROUP],
    ]);
  });

  it('reads no groups when there is nothing to name', async () => {
    const { client, queries } = fake({ 'rpc:waves_my_agent_writes': { data: [] } });
    const { json } = await call(client, 'list_agent_writes');
    expect(json).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it('is offered on a read-only server', async () => {
    const server = buildWavesServer(fake({}).client, ME, true);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const { tools } = await client.listTools();
    await client.close();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['list_agent_writes', 'list_settlements', 'settlement_plan']),
    );
  });
});

describe('"Matt paid me ₹100 in cash"', () => {
  it('finds Matt by first name and me as me, and records it that way round', async () => {
    const { client, rpcs } = fake({});
    const { isError, json } = await call(client, 'record_settlement', {
      groupId: GROUP,
      from: 'Matt',
      to: 'me',
      amount: '10000',
      rail: 'cash',
    });

    expect(isError).toBe(false);
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]!.args).toMatchObject({
      p_from_member_id: M_MATT,
      p_to_member_id: M_ME,
      p_amount: '10000',
      p_method: 'cash',
    });
    expect(json).toMatchObject({
      from: { name: 'Matt Hardy' },
      to: { name: 'Madan', isYou: true },
      status: 'initiated',
    });
  });

  it('mixes a name and an id', async () => {
    const { client, rpcs } = fake({});
    await call(client, 'record_settlement', {
      groupId: GROUP,
      fromMemberId: M_ME,
      to: 'raj',
      amount: '500',
    });
    expect(rpcs[0]!.args).toMatchObject({ p_from_member_id: M_ME, p_to_member_id: M_RAJ });
  });

  it('never adds somebody it cannot find, and records nothing', async () => {
    const { client, rpcs } = fake({});
    const { isError, text } = await call(client, 'record_settlement', {
      groupId: GROUP,
      from: 'Priya',
      to: 'me',
      amount: '500',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Nobody called "Priya"');
    expect(text).toContain('Matt Hardy');
    expect(rpcs).toHaveLength(0);
  });

  it('asks which one when a name fits two members', async () => {
    const { client, rpcs } = fake({
      group_members: {
        data: [
          ...MEMBERS,
          {
            id: '44444444-4444-4444-8444-444444444444',
            profile_id: null,
            ghost_name: 'Matt Smith',
            profile: null,
          },
        ],
      },
    });
    const { isError, text } = await call(client, 'record_settlement', {
      groupId: GROUP,
      from: 'Matt',
      to: 'me',
      amount: '500',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Matt Hardy, Matt Smith');
    expect(rpcs).toHaveLength(0);
  });

  it('refuses a settlement from somebody to themselves', async () => {
    const { client, rpcs } = fake({});
    const { isError } = await call(client, 'record_settlement', {
      groupId: GROUP,
      from: 'me',
      to: 'Madan',
      amount: '500',
    });
    expect(isError).toBe(true);
    expect(rpcs).toHaveLength(0);
  });

  it('asks who paid when neither a name nor an id is given', async () => {
    const { client, rpcs } = fake({});
    const { isError, text } = await call(client, 'record_settlement', {
      groupId: GROUP,
      to: 'me',
      amount: '500',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Say who paid');
    expect(rpcs).toHaveLength(0);
  });

  it('still takes two member ids without reading the group', async () => {
    const { client, rpcs, queries } = fake({});
    await call(client, 'record_settlement', {
      groupId: GROUP,
      fromMemberId: M_MATT,
      toMemberId: M_ME,
      amount: '500',
    });
    expect(queries).toHaveLength(0);
    expect(rpcs[0]!.args).toMatchObject({ p_from_member_id: M_MATT, p_to_member_id: M_ME });
  });
});
