/**
 * The read tools, driven through a real MCP client.
 *
 * What an agent reads here is what it acts on next: a member id to put a debt
 * on, a balance to settle, a version number to edit against. So these check
 * the shape a tool hands back and the filters it reads with — a missing
 * `left_at` filter would offer an agent somebody who has left the group, and
 * nothing in the response would say so.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { buildWavesServer } from './tools';

const ME = 'profile-me';
const GROUP = '7473b904-c06b-490b-97b5-12e4b166db8b';

type Filter = [method: string, ...args: unknown[]];
type Answer = { data?: unknown; error?: { message: string } | null };

/**
 * A Supabase client that answers each table with a canned result and keeps
 * every filter applied to it, in order.
 */
function fakeSupabase(answers: Record<string, Answer>, email: string | null = 'me@example.test') {
  const queries: { table: string; filters: Filter[] }[] = [];
  const client = {
    from(table: string) {
      const filters: Filter[] = [];
      queries.push({ table, filters });
      const answer = answers[table] ?? { data: [] };
      const result = { data: answer.data ?? null, error: answer.error ?? null };
      const query: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      };
      for (const m of ['select', 'eq', 'is', 'order', 'limit']) {
        query[m] = (...args: unknown[]) => {
          filters.push([m, ...args]);
          return query;
        };
      }
      return query;
    },
    auth: { getUser: async () => ({ data: { user: email ? { email } : null } }) },
  } as unknown as SupabaseClient;
  return { client, queries };
}

async function connect(supabase: SupabaseClient, readOnly = false): Promise<Client> {
  const server = buildWavesServer(supabase, ME, readOnly);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

/** Call a tool and return its parsed JSON, or its error text. */
async function call(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
  readOnly = false,
): Promise<{ isError: boolean; text: string; json: unknown }> {
  const client = await connect(supabase, readOnly);
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* an error message, not JSON */
  }
  return { isError: Boolean(result.isError), text, json };
}

describe('the read-only server', () => {
  it('offers the read tools and none of the writes', async () => {
    const client = await connect(fakeSupabase({}).client, true);
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_balances',
      'list_expenses',
      'list_groups',
      'list_members',
      'payment_link',
      'whoami',
    ]);
  });
});

describe('whoami', () => {
  it('names the person the server acts as, and whether it can write', async () => {
    const { json } = await call(fakeSupabase({}).client, 'whoami');
    expect(json).toEqual({ userId: ME, email: 'me@example.test', readOnly: false });
  });

  it('says so when it is read-only', async () => {
    const { json } = await call(fakeSupabase({}).client, 'whoami', {}, true);
    expect(json).toMatchObject({ readOnly: true });
  });

  it('gives a null email rather than failing when the session has no user', async () => {
    const { isError, json } = await call(fakeSupabase({}, null).client, 'whoami');
    expect(isError).toBe(false);
    expect(json).toEqual({ userId: ME, email: null, readOnly: false });
  });
});

describe('list_groups', () => {
  const row = {
    id: GROUP,
    name: 'Goa',
    type: 'trip',
    default_currency: 'INR',
    cover_emoji: '✈️',
    archived_at: null,
    start_date: '2026-09-10',
    end_date: '2026-09-18',
  };

  it('renames the columns into what an agent asks about', async () => {
    const { json } = await call(fakeSupabase({ groups: { data: [row] } }).client, 'list_groups');
    expect(json).toEqual([
      {
        id: GROUP,
        name: 'Goa',
        type: 'trip',
        currency: 'INR',
        emoji: '✈️',
        archived: false,
        startDate: '2026-09-10',
        endDate: '2026-09-18',
      },
    ]);
  });

  it('marks an archived group as a boolean, not a timestamp', async () => {
    const archived = { ...row, archived_at: '2026-09-20T00:00:00Z' };
    const { json } = await call(
      fakeSupabase({ groups: { data: [archived] } }).client,
      'list_groups',
      { includeArchived: true },
    );
    expect((json as { archived: unknown }[])[0]!.archived).toBe(true);
  });

  it('never lists deleted groups, and hides archived ones unless asked', async () => {
    const hidden = fakeSupabase({});
    await call(hidden.client, 'list_groups');
    expect(hidden.queries[0]!.filters).toContainEqual(['is', 'deleted_at', null]);
    expect(hidden.queries[0]!.filters).toContainEqual(['is', 'archived_at', null]);

    const shown = fakeSupabase({});
    await call(shown.client, 'list_groups', { includeArchived: true });
    expect(shown.queries[0]!.filters).toContainEqual(['is', 'deleted_at', null]);
    expect(shown.queries[0]!.filters).not.toContainEqual(['is', 'archived_at', null]);
  });

  it('lists newest first', async () => {
    const { client, queries } = fakeSupabase({});
    await call(client, 'list_groups');
    expect(queries[0]!.filters).toContainEqual(['order', 'created_at', { ascending: false }]);
  });

  it('hands back an empty list, not null, when there are no groups', async () => {
    const { json } = await call(fakeSupabase({ groups: { data: null } }).client, 'list_groups');
    expect(json).toEqual([]);
  });

  it('reports a failed read as an error', async () => {
    const { isError, text } = await call(
      fakeSupabase({ groups: { error: { message: 'permission denied' } } }).client,
      'list_groups',
    );
    expect(isError).toBe(true);
    expect(text).toBe('permission denied');
  });
});

describe('list_members', () => {
  const member = (overrides: Record<string, unknown>) => ({
    id: 'member-x',
    group_id: GROUP,
    profile_id: null,
    ghost_name: null,
    vpa: null,
    payment_rail: null,
    payment_handle: null,
    role: 'member',
    profile: null,
    ...overrides,
  });

  async function members(rows: unknown[]) {
    const { json } = await call(
      fakeSupabase({ group_members: { data: rows } }).client,
      'list_members',
      { groupId: GROUP },
    );
    return json as Record<string, unknown>[];
  }

  it('marks the signed-in person as you, and a member without an account as a ghost', async () => {
    const [you, ghost] = await members([
      member({ id: 'm-me', profile_id: ME, role: 'admin', profile: { display_name: 'Madan' } }),
      member({ id: 'm-matt', ghost_name: 'Matt' }),
    ]);
    expect(you).toMatchObject({ memberId: 'm-me', name: 'Madan', isYou: true, isGhost: false });
    expect(you!.role).toBe('admin');
    expect(ghost).toMatchObject({ memberId: 'm-matt', name: 'Matt', isYou: false, isGhost: true });
  });

  it('names a member by their profile, then their ghost name, then "Unnamed"', async () => {
    const names = (
      await members([
        member({ profile_id: 'p', ghost_name: 'Old name', profile: { display_name: 'Priya' } }),
        member({ ghost_name: 'Raj' }),
        member({}),
      ])
    ).map((m) => m.name);
    expect(names).toEqual(['Priya', 'Raj', 'Unnamed']);
  });

  it("prefers the member's own payment details over their profile's", async () => {
    const [m] = await members([
      member({
        payment_rail: 'paypal',
        payment_handle: 'matt',
        vpa: 'matt@upi',
        profile_id: 'p',
        profile: { payment_rail: 'payid', payment_handle: '+61400000000', default_vpa: 'p@upi' },
      }),
    ]);
    expect(m).toMatchObject({ rail: 'paypal', handle: 'matt', vpa: 'matt' });
  });

  it('falls back member vpa → profile rail → profile vpa, in that order', async () => {
    const rows = await members([
      member({ vpa: 'member@upi', profile: { default_vpa: 'profile@upi' } }),
      member({ profile: { payment_rail: 'paypal', payment_handle: 'pp', default_vpa: 'p@upi' } }),
      member({ profile: { default_vpa: 'profile@upi' } }),
    ]);
    expect(rows.map((m) => [m.rail, m.handle])).toEqual([
      ['upi', 'member@upi'],
      ['paypal', 'pp'],
      ['upi', 'profile@upi'],
    ]);
  });

  it('never pairs a rail from one source with a handle from another', async () => {
    const [m] = await members([
      member({
        payment_rail: 'payid',
        profile: { payment_handle: '+61400000000', default_vpa: 'p@upi' },
      }),
    ]);
    expect(m).toMatchObject({ rail: 'upi', handle: 'p@upi' });
  });

  it('gives null payment details when nobody has set any', async () => {
    const [m] = await members([member({ ghost_name: 'Raj' })]);
    expect(m).toMatchObject({ rail: null, handle: null, vpa: null });
  });

  it('reads only this group, only people still in it, oldest first', async () => {
    const { client, queries } = fakeSupabase({});
    await call(client, 'list_members', { groupId: GROUP });
    expect(queries[0]!.table).toBe('group_members');
    expect(queries[0]!.filters).toContainEqual(['eq', 'group_id', GROUP]);
    expect(queries[0]!.filters).toContainEqual(['is', 'left_at', null]);
    expect(queries[0]!.filters).toContainEqual(['order', 'created_at', { ascending: true }]);
  });

  it('refuses a group id that is not a uuid before reading anything', async () => {
    const { client, queries } = fakeSupabase({});
    const { isError } = await call(client, 'list_members', { groupId: 'Goa' });
    expect(isError).toBe(true);
    expect(queries).toHaveLength(0);
  });

  it('reports a failed read as an error', async () => {
    const { isError, text } = await call(
      fakeSupabase({ group_members: { error: { message: 'boom' } } }).client,
      'list_members',
      { groupId: GROUP },
    );
    expect(isError).toBe(true);
    expect(text).toBe('boom');
  });
});

describe('get_balances', () => {
  it('passes balances through in minor units, scoped to the group', async () => {
    const rows = [
      { member_id: 'm-me', currency: 'INR', balance: 10000 },
      { member_id: 'm-matt', currency: 'INR', balance: -10000 },
    ];
    const { client, queries } = fakeSupabase({ group_balances: { data: rows } });
    const { json } = await call(client, 'get_balances', { groupId: GROUP });

    expect(json).toEqual(rows);
    expect(queries[0]!.table).toBe('group_balances');
    expect(queries[0]!.filters).toContainEqual(['eq', 'group_id', GROUP]);
  });

  it('hands back an empty list for a group with nothing owed', async () => {
    const { json } = await call(
      fakeSupabase({ group_balances: { data: null } }).client,
      'get_balances',
      { groupId: GROUP },
    );
    expect(json).toEqual([]);
  });

  it('reports a failed read as an error', async () => {
    const { isError } = await call(
      fakeSupabase({ group_balances: { error: { message: 'boom' } } }).client,
      'get_balances',
      { groupId: GROUP },
    );
    expect(isError).toBe(true);
  });
});

describe('list_expenses', () => {
  const current = {
    version_no: 2,
    description: 'Chai',
    category: 'food',
    expense_date: '2026-09-26',
    currency: 'INR',
    amount: 20000,
    split_type: 'equal',
    author_member_id: 'm-me',
    notes: null,
    payers: [{ member_id: 'm-me', amount: 20000 }],
    shares: [
      { member_id: 'm-me', amount: 10000 },
      { member_id: 'm-matt', amount: 10000 },
    ],
  };

  async function expenses(rows: unknown[]) {
    const { json } = await call(
      fakeSupabase({ expenses: { data: rows } }).client,
      'list_expenses',
      { groupId: GROUP },
    );
    return json as Record<string, unknown>[];
  }

  it('reads each expense at its current version, with the number an edit needs', async () => {
    const [e] = await expenses([{ id: 'e1', deleted_at: null, created_at: 'x', current }]);
    expect(e).toEqual({
      expenseId: 'e1',
      deleted: false,
      versionNo: 2,
      description: 'Chai',
      amount: 20000,
      currency: 'INR',
      date: '2026-09-26',
      splitType: 'equal',
      category: 'food',
      notes: null,
      payers: current.payers,
      shares: current.shares,
    });
  });

  it('accepts the current version embedded as an array as well as an object', async () => {
    const [asArray] = await expenses([
      { id: 'e1', deleted_at: null, created_at: 'x', current: [current] },
    ]);
    expect(asArray).toMatchObject({ versionNo: 2, description: 'Chai', amount: 20000 });
  });

  it('gives nulls and empty lists, not a crash, when the current version is missing', async () => {
    const [e] = await expenses([{ id: 'e1', deleted_at: null, created_at: 'x', current: null }]);
    expect(e).toMatchObject({
      expenseId: 'e1',
      versionNo: null,
      amount: null,
      payers: [],
      shares: [],
    });
  });

  it('marks a deleted expense', async () => {
    const [e] = await expenses([
      { id: 'e1', deleted_at: '2026-09-26T00:00:00Z', created_at: 'x', current },
    ]);
    expect(e!.deleted).toBe(true);
  });

  it('reads 20 newest-first by default and hides deleted expenses', async () => {
    const { client, queries } = fakeSupabase({});
    await call(client, 'list_expenses', { groupId: GROUP });
    const { filters } = queries[0]!;
    expect(filters).toContainEqual(['eq', 'group_id', GROUP]);
    expect(filters).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(filters).toContainEqual(['limit', 20]);
    expect(filters).toContainEqual(['is', 'deleted_at', null]);
  });

  it('includes deleted expenses and honours the limit when asked', async () => {
    const { client, queries } = fakeSupabase({});
    await call(client, 'list_expenses', { groupId: GROUP, limit: 5, includeDeleted: true });
    expect(queries[0]!.filters).toContainEqual(['limit', 5]);
    expect(queries[0]!.filters).not.toContainEqual(['is', 'deleted_at', null]);
  });

  it('refuses a limit over 100 before reading anything', async () => {
    const { client, queries } = fakeSupabase({});
    const { isError } = await call(client, 'list_expenses', { groupId: GROUP, limit: 101 });
    expect(isError).toBe(true);
    expect(queries).toHaveLength(0);
  });

  it('reports a failed read as an error', async () => {
    const { isError } = await call(
      fakeSupabase({ expenses: { error: { message: 'boom' } } }).client,
      'list_expenses',
      { groupId: GROUP },
    );
    expect(isError).toBe(true);
  });
});

describe('payment_link', () => {
  const link = (args: Record<string, unknown>) =>
    call(fakeSupabase({}).client, 'payment_link', args);

  it('builds a UPI intent with the amount in rupees', async () => {
    const { json } = await link({
      payeeVpa: 'matt@okhdfcbank',
      payeeName: 'Matt',
      amount: '12550',
    });
    expect(json).toEqual({
      rail: 'upi',
      uri: 'upi://pay?pa=matt%40okhdfcbank&pn=Matt&am=125.50&cu=INR',
      amountMajor: '125.50',
      currency: 'INR',
    });
  });

  it('leaves the payee name out when none is given', async () => {
    const { json } = await link({ payeeVpa: 'matt@upi', amount: '100' });
    expect((json as { uri: string }).uri).toBe('upi://pay?pa=matt%40upi&am=1.00&cu=INR');
  });

  it('keeps paise exact, including amounts under a rupee', async () => {
    const { json } = await link({ payeeVpa: 'a@upi', amount: '5' });
    expect((json as { amountMajor: string }).amountMajor).toBe('0.05');
  });

  it('keeps amounts too large for a float exact', async () => {
    const { json } = await link({ payeeVpa: 'a@upi', amount: '900719925474099399' });
    expect((json as { amountMajor: string }).amountMajor).toBe('9007199254740993.99');
  });

  it('builds a PayPal.me link, escaping the handle', async () => {
    const { json } = await link({
      rail: 'paypal',
      payeeHandle: 'matt/x',
      amount: '2000',
      currency: 'usd',
    });
    expect(json).toEqual({
      rail: 'paypal',
      uri: 'https://paypal.me/matt%2Fx/20.00USD',
      amountMajor: '20.00',
      currency: 'USD',
    });
  });

  it('refuses a UPI link without a UPI id', async () => {
    const { isError, text } = await link({ amount: '100' });
    expect(isError).toBe(true);
    expect(text).toContain('payeeVpa');
  });

  it('refuses a PayPal link without a handle', async () => {
    const { isError, text } = await link({ rail: 'paypal', amount: '100' });
    expect(isError).toBe(true);
    expect(text).toContain('payeeHandle');
  });

  it('refuses an amount that is not integer minor units', async () => {
    const { isError } = await link({ payeeVpa: 'a@upi', amount: '125.50' });
    expect(isError).toBe(true);
  });

  it('reads nothing from the database', async () => {
    const { client, queries } = fakeSupabase({});
    await call(client, 'payment_link', { payeeVpa: 'a@upi', amount: '100' });
    expect(queries).toHaveLength(0);
  });
});
