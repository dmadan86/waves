/**
 * The things people actually say to an agent, end to end through the tools.
 *
 * Each case starts from a sentence somebody would type — "split dinner with
 * Raj and Priya", "Matt paid me back in cash" — and checks what reaches the
 * ledger: who is on the expense, who paid, in what currency, and that a
 * request which should stop does stop before anything is written. A wrong
 * answer here is a real debt on the wrong person, so "nothing was written" is
 * asserted as carefully as what was.
 */

import { randomUUID } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildWavesServer } from './tools';

const ME_PROFILE = randomUUID();
const GROUP = randomUUID();

type Member = { id: string; profile_id: string | null; ghost_name: string | null; name?: string };

/**
 * A small Waves: one group, its members, and a record of every write. Ghost
 * members really join, so a second lookup finds the person the first one added.
 */
function world(opts: {
  members?: { name: string; you?: boolean }[];
  currency?: string;
  groupMissing?: boolean;
  edgeRefusal?: { code?: string; message?: string };
  rpcError?: Record<string, string>;
}) {
  const members: Member[] = (opts.members ?? [{ name: 'Madan', you: true }]).map((m) => ({
    id: randomUUID(),
    profile_id: m.you ? ME_PROFILE : null,
    ghost_name: m.you ? null : m.name,
    name: m.you ? m.name : undefined,
  }));
  const writes = {
    ghosts: [] as string[],
    expenses: [] as Record<string, unknown>[],
    rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  };
  const idOf = (name: string) =>
    members.find((m) => (m.name ?? m.ghost_name) === name)?.id ?? `<no ${name}>`;

  const table = (name: string) => {
    const rows =
      name === 'group_members'
        ? members.map((m) => ({
            id: m.id,
            profile_id: m.profile_id,
            ghost_name: m.ghost_name,
            profile: m.name ? { display_name: m.name } : null,
          }))
        : [];
    const query: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
      single: async () =>
        opts.groupMissing
          ? {
              data: null,
              error: { message: 'JSON object requested, multiple (or no) rows returned' },
            }
          : { data: { default_currency: opts.currency ?? 'INR' }, error: null },
    };
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) query[m] = () => query;
    return query;
  };

  const supabase = {
    from: table,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      writes.rpcs.push({ fn, args });
      if (opts.rpcError?.[fn]) return { data: null, error: { message: opts.rpcError[fn] } };
      switch (fn) {
        case 'waves_my_member_id_for':
          return {
            data: members.find((m) => m.profile_id === args.p_profile_id)?.id ?? null,
            error: null,
          };
        case 'waves_add_ghost_member': {
          const ghost = { id: randomUUID(), profile_id: null, ghost_name: String(args.p_name) };
          members.push(ghost);
          writes.ghosts.push(ghost.ghost_name);
          return { data: ghost.id, error: null };
        }
        case 'waves_ensure_group_join_token':
          return { data: 'tok_abc', error: null };
        default:
          return { data: randomUUID(), error: null };
      }
    },
    functions: {
      invoke: async (_fn: string, { body }: { body: Record<string, unknown> }) => {
        if (opts.edgeRefusal) {
          const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
            context: new Response(JSON.stringify(opts.edgeRefusal), { status: 422 }),
          });
          return { data: null, error };
        }
        writes.expenses.push(body);
        return { data: { versionNo: 1 }, error: null };
      },
    },
    auth: { getUser: async () => ({ data: { user: { email: 'me@example.test' } } }) },
  } as unknown as SupabaseClient;

  const say = async (name: string, args: Record<string, unknown>, readOnly = false) => {
    const server = buildWavesServer(supabase, ME_PROFILE, readOnly);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const result = await client.callTool({ name, arguments: { groupId: GROUP, ...args } });
    await client.close();
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* an error message */
    }
    return { isError: Boolean(result.isError), text, json };
  };

  return { say, writes, idOf, members };
}

const nothingWritten = (writes: ReturnType<typeof world>['writes']) => {
  expect(writes.expenses).toHaveLength(0);
  expect(writes.ghosts).toHaveLength(0);
};

describe('"Split ₹600 for dinner with Raj and Priya"', () => {
  it('adds Priya, who is new, and puts all three on it with me paying', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Raj' }] });

    const { isError, json } = await w.say('add_expense', {
      description: 'Dinner',
      amount: '60000',
      people: ['Raj', 'Priya'],
    });

    expect(isError).toBe(false);
    expect(w.writes.ghosts).toEqual(['Priya']);
    expect(json.addedToGroup).toEqual(['Priya']);
    const [expense] = w.writes.expenses;
    expect(new Set(expense!.participants as string[])).toEqual(
      new Set([w.idOf('Madan'), w.idOf('Raj'), w.idOf('Priya')]),
    );
    expect(expense!.payers).toEqual({ [w.idOf('Madan')]: '60000' });
    expect(expense!.currency).toBe('INR');
    expect(expense!.splitParams).toEqual({ kind: 'equal' });
  });

  it('finds Raj however the name is typed, rather than adding a second Raj', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Raj' }] });

    await w.say('add_expense', { description: 'Dinner', amount: '60000', people: ['  raj '] });

    expect(w.writes.ghosts).toEqual([]);
    expect(w.writes.expenses[0]!.participants).toContain(w.idOf('Raj'));
  });

  it('stops and asks which Raj when two members share the name', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Raj' }, { name: 'Raj' }] });

    const { isError, text } = await w.say('add_expense', {
      description: 'Dinner',
      amount: '60000',
      people: ['Raj'],
    });

    expect(isError).toBe(true);
    expect(text).toContain('"Raj" matches 2 members');
    nothingWritten(w.writes);
  });

  it('counts me once when I name myself as well', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Raj' }] });

    await w.say('add_expense', {
      description: 'Dinner',
      amount: '60000',
      people: ['Madan', 'Raj'],
    });

    expect(w.writes.expenses[0]!.participants).toHaveLength(2);
  });

  it('adds a new person once when they are named twice', async () => {
    const w = world({});

    await w.say('add_expense', {
      description: 'Dinner',
      amount: '60000',
      people: ['Priya', 'priya'],
    });

    expect(w.writes.ghosts).toEqual(['Priya']);
    expect(w.writes.expenses[0]!.participants).toHaveLength(2);
  });
});

describe('who paid, how much, and when', () => {
  it('"Matt paid ₹200 for chai" puts the debt on me, not Matt', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Matt' }] });

    await w.say('add_expense', {
      description: 'Chai',
      amount: '20000',
      paidBy: w.idOf('Matt'),
      participants: [w.idOf('Madan')],
    });

    const [expense] = w.writes.expenses;
    expect(expense!.payers).toEqual({ [w.idOf('Matt')]: '20000' });
    expect(new Set(expense!.participants as string[])).toEqual(
      new Set([w.idOf('Madan'), w.idOf('Matt')]),
    );
  });

  it('"I paid $30" in a rupee group keeps the dollars', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Raj' }] });

    await w.say('add_expense', {
      description: 'Museum',
      amount: '3000',
      currency: 'usd',
      people: ['Raj'],
    });

    expect(w.writes.expenses[0]!.currency).toBe('USD');
  });

  it("uses the group's own currency when none is said", async () => {
    const w = world({ currency: 'EUR', members: [{ name: 'Madan', you: true }, { name: 'Raj' }] });

    await w.say('add_expense', { description: 'Pizza', amount: '1500', people: ['Raj'] });

    expect(w.writes.expenses[0]!.currency).toBe('EUR');
  });

  it('"yesterday\'s taxi" keeps the date it is given, and today is the default', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Raj' }] });

    await w.say('add_expense', {
      description: 'Taxi',
      amount: '45000',
      people: ['Raj'],
      expenseDate: '2026-09-25',
    });
    await w.say('add_expense', { description: 'Taxi', amount: '45000', people: ['Raj'] });

    expect(w.writes.expenses[0]!.expenseDate).toBe('2026-09-25');
    expect(w.writes.expenses[1]!.expenseDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it('"I had ₹150 of it, Raj ₹50" sends the exact split for the server to check', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Raj' }] });
    const amounts = { [w.idOf('Madan')]: '15000', [w.idOf('Raj')]: '5000' };

    await w.say('add_expense', {
      description: 'Groceries',
      amount: '20000',
      participants: [w.idOf('Raj')],
      split: { kind: 'exact', amounts },
    });

    expect(w.writes.expenses[0]!.splitParams).toEqual({ kind: 'exact', amounts });
  });
});

describe('requests that should stop before anything is written', () => {
  it('a group I cannot see, or that was deleted', async () => {
    const w = world({ groupMissing: true });

    const { isError } = await w.say('add_expense', {
      description: 'Dinner',
      amount: '60000',
      people: ['Raj'],
    });

    expect(isError).toBe(true);
    nothingWritten(w.writes);
  });

  it('"₹200" or "200.50" as the amount, instead of minor units', async () => {
    for (const amount of ['₹200', '200.50', '-200']) {
      const w = world({});
      const { isError } = await w.say('add_expense', {
        description: 'Chai',
        amount,
        people: ['Raj'],
      });
      expect(isError, amount).toBe(true);
      nothingWritten(w.writes);
    }
  });

  it('an expense with nobody on it', async () => {
    const w = world({});

    const { isError, text } = await w.say('add_expense', { description: 'Chai', amount: '20000' });

    expect(isError).toBe(true);
    expect(text).toContain('Say who the expense is split between');
    nothingWritten(w.writes);
  });

  it('an expense in a group I have left, with nobody named as the payer', async () => {
    const w = world({ members: [{ name: 'Raj' }] });

    const { isError, text } = await w.say('add_expense', {
      description: 'Chai',
      amount: '20000',
      participants: [w.idOf('Raj')],
    });

    expect(isError).toBe(true);
    expect(text).toContain('say who paid with paidBy');
    nothingWritten(w.writes);
  });

  it('a split the server refuses comes back with its reason, not a generic failure', async () => {
    const w = world({
      members: [{ name: 'Madan', you: true }, { name: 'Raj' }],
      edgeRefusal: { code: 'SPLIT_MISMATCH', message: 'Exact amounts must add up to the total' },
    });

    const { isError, text } = await w.say('add_expense', {
      description: 'Groceries',
      amount: '20000',
      people: ['Raj'],
      split: { kind: 'exact', amounts: { [w.idOf('Raj')]: '1' } },
    });

    expect(isError).toBe(true);
    expect(text).toBe('SPLIT_MISMATCH: Exact amounts must add up to the total');
  });

  it('nothing at all on a read-only server', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Raj' }] });

    const { isError } = await w.say(
      'add_expense',
      { description: 'Chai', amount: '20000', people: ['Raj'] },
      true,
    );

    expect(isError).toBe(true);
    nothingWritten(w.writes);
    expect(w.writes.rpcs).toHaveLength(0);
  });
});

describe('"Actually dinner was ₹700"', () => {
  it('edits against the version it read, keeping the same expense', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Raj' }] });
    const expenseId = randomUUID();

    const { isError, json } = await w.say('edit_expense', {
      expenseId,
      baseVersionNo: 1,
      description: 'Dinner',
      amount: '70000',
      paidBy: w.idOf('Madan'),
      participants: [w.idOf('Madan'), w.idOf('Raj')],
    });

    expect(isError).toBe(false);
    expect(json.expenseId).toBe(expenseId);
    expect(w.writes.expenses[0]).toMatchObject({ expenseId, baseVersionNo: 1, amount: '70000' });
  });

  it('says so when somebody else edited it first, instead of overwriting them', async () => {
    const w = world({
      members: [{ name: 'Madan', you: true }, { name: 'Raj' }],
      edgeRefusal: { code: 'VERSION_CONFLICT', message: 'This expense changed since you read it' },
    });

    const { isError, text } = await w.say('edit_expense', {
      expenseId: randomUUID(),
      baseVersionNo: 1,
      description: 'Dinner',
      amount: '70000',
      paidBy: w.idOf('Madan'),
      participants: [w.idOf('Raj')],
    });

    expect(isError).toBe(true);
    expect(text).toContain('VERSION_CONFLICT');
  });
});

describe('"Delete the chai"', () => {
  it('passes on a refusal, such as an expense that is not mine to delete', async () => {
    const w = world({ rpcError: { waves_delete_expense: 'not allowed' } });

    const { isError, text } = await w.say('delete_expense', { expenseId: randomUUID() });

    expect(isError).toBe(true);
    expect(text).toBe('not allowed');
  });
});

describe('settling up', () => {
  const settlement = (w: ReturnType<typeof world>) =>
    w.writes.rpcs.find((r) => r.fn === 'waves_record_settlement')!.args;

  it('"Matt paid me back ₹100 in cash" records cash, and says no money moved', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Matt' }] });

    const { json } = await w.say('record_settlement', {
      fromMemberId: w.idOf('Matt'),
      toMemberId: w.idOf('Madan'),
      amount: '10000',
      rail: 'cash',
    });

    expect(settlement(w)).toMatchObject({
      p_from_member_id: w.idOf('Matt'),
      p_to_member_id: w.idOf('Madan'),
      p_amount: '10000',
      p_method: 'cash',
      p_rail: 'cash',
    });
    expect(String(json.note)).toContain('no money moved');
  });

  it('"I paid Matt on PayPal" keeps the rail, filed under an "other" method', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Matt' }] });

    await w.say('record_settlement', {
      fromMemberId: w.idOf('Madan'),
      toMemberId: w.idOf('Matt'),
      amount: '10000',
      rail: 'paypal',
    });

    expect(settlement(w)).toMatchObject({ p_method: 'other', p_rail: 'paypal' });
  });

  it('defaults to UPI when no rail is said', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Matt' }] });

    await w.say('record_settlement', {
      fromMemberId: w.idOf('Matt'),
      toMemberId: w.idOf('Madan'),
      amount: '10000',
    });

    expect(settlement(w)).toMatchObject({ p_method: 'upi', p_rail: 'upi' });
  });

  it('passes on the refusal when I am not one of the two people', async () => {
    const w = world({
      members: [{ name: 'Madan', you: true }, { name: 'Matt' }, { name: 'Raj' }],
      rpcError: { waves_record_settlement: 'You must be a party to the settlement' },
    });

    const { isError, text } = await w.say('record_settlement', {
      fromMemberId: w.idOf('Matt'),
      toMemberId: w.idOf('Raj'),
      amount: '10000',
    });

    expect(isError).toBe(true);
    expect(text).toBe('You must be a party to the settlement');
  });
});

describe('"Add Raj and Priya to the group"', () => {
  it('adds only the one who is new, and asking again adds nobody', async () => {
    const w = world({ members: [{ name: 'Madan', you: true }, { name: 'Raj' }] });

    const first = await w.say('add_people', { names: ['Raj', 'Priya'] });
    const again = await w.say('add_people', { names: ['Raj', 'Priya'] });

    expect(first.json.added).toEqual(['Priya']);
    expect(again.json.added).toEqual([]);
    expect(w.writes.ghosts).toEqual(['Priya']);
    expect((again.json.members as { memberId: string }[]).map((m) => m.memberId)).toEqual([
      w.idOf('Raj'),
      w.idOf('Priya'),
    ]);
  });
});

describe('"Make a Goa trip group, in dollars"', () => {
  it('sends codes in upper case and leaves a blank name for the app to fill', async () => {
    const w = world({});

    const { json } = await w.say('create_group', {
      name: '   ',
      type: 'trip',
      currency: 'usd',
      country: 'in',
    });

    expect(json.groupId).toBeTruthy();
    expect(w.writes.rpcs[0]!.args).toMatchObject({
      p_name: null,
      p_type: 'trip',
      p_currency: 'USD',
      p_country: 'IN',
      p_simplify: true,
    });
  });
});

describe('"Send Matt the invite link"', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('puts the token after the #, so it never reaches a server log', async () => {
    vi.stubEnv('WAVES_WEB_URL', 'https://staging.example.test');
    const { json } = await world({}).say('invite_link', {});
    expect(json.url).toBe('https://staging.example.test/join#tok_abc');
  });

  it('points at the app when no web address is configured', async () => {
    vi.stubEnv('WAVES_WEB_URL', undefined as unknown as string);
    const { json } = await world({}).say('invite_link', {});
    expect(json.url).toBe('https://app.wavs.co.in/join#tok_abc');
  });
});

describe('naming people the way people do', () => {
  const group = () =>
    world({
      members: [
        { name: 'Madan Deivasigmani', you: true },
        { name: 'Matt' },
        { name: 'Renny Benita' },
        { name: 'Arun Mill' },
        { name: 'Arun T' },
      ],
    });

  it('"split with me and Matt" is two people, not a new member called "me"', async () => {
    for (const self of ['me', 'Me', 'I', 'myself']) {
      const w = group();
      await w.say('add_expense', { description: 'Chai', amount: '20000', people: [self, 'Matt'] });
      expect(w.writes.ghosts, self).toEqual([]);
      expect(new Set(w.writes.expenses[0]!.participants as string[]), self).toEqual(
        new Set([w.idOf('Madan Deivasigmani'), w.idOf('Matt')]),
      );
    }
  });

  it('a first name finds the one member it belongs to', async () => {
    const w = group();

    await w.say('add_expense', {
      description: 'Chai',
      amount: '30000',
      people: ['Madan', 'renny', 'Matt'],
    });

    expect(w.writes.ghosts).toEqual([]);
    expect(new Set(w.writes.expenses[0]!.participants as string[])).toEqual(
      new Set([w.idOf('Madan Deivasigmani'), w.idOf('Renny Benita'), w.idOf('Matt')]),
    );
  });

  it('prefers the member called exactly that over one whose first name it is', async () => {
    const w = world({
      members: [{ name: 'Madan', you: true }, { name: 'Raj' }, { name: 'Raj Kumar' }],
    });

    await w.say('add_expense', { description: 'Chai', amount: '20000', people: ['Raj'] });

    expect(w.writes.expenses[0]!.participants).toContain(w.idOf('Raj'));
    expect(w.writes.expenses[0]!.participants).not.toContain(w.idOf('Raj Kumar'));
  });

  it('asks which Arun, naming both, when two members share the first name', async () => {
    const w = group();

    const { isError, text } = await w.say('add_expense', {
      description: 'Chai',
      amount: '20000',
      people: ['Arun'],
    });

    expect(isError).toBe(true);
    expect(text).toContain('Arun Mill, Arun T');
    nothingWritten(w.writes);
  });

  it('adds nobody when a later name turns out to be ambiguous', async () => {
    const w = group();

    const { isError } = await w.say('add_expense', {
      description: 'Dinner',
      amount: '60000',
      people: ['Priya', 'Arun'],
    });

    expect(isError).toBe(true);
    nothingWritten(w.writes);
  });

  it('does not guess from part of a longer name', async () => {
    const w = group();

    const { json } = await w.say('add_people', { names: ['Renny B'] });

    expect(json.added).toEqual(['Renny B']);
  });

  it('refuses "me" in a group I am not in, instead of adding someone called "me"', async () => {
    const w = world({ members: [{ name: 'Matt' }] });

    const { isError, text } = await w.say('add_expense', {
      description: 'Chai',
      amount: '20000',
      paidBy: w.idOf('Matt'),
      people: ['me'],
    });

    expect(isError).toBe(true);
    expect(text).toContain('you are not a member of this group');
    nothingWritten(w.writes);
  });

  it('"add me and Matt" finds us both and adds nobody', async () => {
    const w = group();

    const { json } = await w.say('add_people', { names: ['me', 'Matt'] });

    expect(json.added).toEqual([]);
    expect((json.members as { memberId: string }[]).map((m) => m.memberId)).toEqual([
      w.idOf('Madan Deivasigmani'),
      w.idOf('Matt'),
    ]);
  });
});
