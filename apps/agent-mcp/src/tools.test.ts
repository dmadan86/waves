/**
 * The agent's RPC calls, checked against the database they will meet.
 *
 * PostgREST resolves an RPC by its exact argument names, so a call missing a
 * required one does not fall back to anything — it fails with "Could not find
 * the function", and only once it reaches a real database. `add_expense`
 * shipped that way: it called `waves_my_member_id_for` without `p_profile_id`,
 * and every expense that left the payer to default failed in production while
 * every mock-backed test agreed with it.
 *
 * So the signatures here are read out of the migrations, not written down a
 * second time, and every write tool is driven through a real MCP client so the
 * arguments checked are the ones a tool actually sends.
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { buildWavesServer, expenseParty } from './tools';

const MIGRATIONS = join(import.meta.dirname, '../../../packages/db/prisma/migrations');

type Signature = { names: string[]; required: string[] };

/** Split an argument list on its top-level commas (a default can hold one). */
function splitArgs(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of list) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && (ch === '(' || ch === '[')) depth++;
    if (!quoted && (ch === ')' || ch === ']')) depth--;
    if (ch === ',' && depth === 0 && !quoted) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The type list Postgres identifies an overload by, which is what DROP names. */
const typeKey = (args: string[]): string =>
  args
    .map((a) =>
      a
        .replace(/\s+DEFAULT\s+.*$/i, '')
        .replace(/^(IN\s+)?p_\w+\s+/i, '')
        .trim()
        .toLowerCase(),
    )
    .join(',');

/**
 * Every public function the migrations leave behind, replaying CREATE and DROP
 * in migration order so a redefinition replaces the version it redefines.
 */
function liveSignatures(): Map<string, Map<string, Signature>> {
  const live = new Map<string, Map<string, Signature>>();
  const statement =
    /(CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION|DROP\s+FUNCTION(?:\s+IF\s+EXISTS)?)\s+public\.(\w+)\s*\(((?:[^()]|\([^()]*\))*)\)/gi;
  for (const dir of readdirSync(MIGRATIONS).sort()) {
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }
    for (const [, verb, fn, list] of sql.matchAll(statement)) {
      const args = splitArgs(list!);
      const key = typeKey(args);
      const overloads = live.get(fn!) ?? new Map<string, Signature>();
      live.set(fn!, overloads);
      if (/^DROP/i.test(verb!)) {
        overloads.delete(key);
        continue;
      }
      const names = args.map((a) => a.replace(/^IN\s+/i, '').split(/\s+/)[0]!);
      const required = args
        .filter((a) => !/\sDEFAULT\s/i.test(a))
        .map((a) => a.replace(/^IN\s+/i, '').split(/\s+/)[0]!);
      overloads.set(key, { names, required });
    }
  }
  return live;
}

/** True when PostgREST would find exactly one function for these argument names. */
function resolves(signatures: Map<string, Signature> | undefined, sent: string[]): boolean {
  const matches = [...(signatures?.values() ?? [])].filter(
    (s) => sent.every((a) => s.names.includes(a)) && s.required.every((a) => sent.includes(a)),
  );
  return matches.length === 1;
}

type RpcCall = { fn: string; args: Record<string, unknown> };

/**
 * A Supabase client that answers every read with something plausible and
 * records every RPC. It does not judge the calls itself — the migrations do.
 */
function recordingSupabase(
  calls: RpcCall[],
  refuse: ReadonlySet<string> = new Set(),
): SupabaseClient {
  const rows = (table: string) => {
    const result =
      table === 'groups'
        ? { data: { default_currency: 'INR' }, error: null }
        : { data: [], error: null };
    const query: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
      single: async () => result,
      maybeSingle: async () => result,
    };
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) query[m] = () => query;
    return query;
  };
  return {
    from: rows,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (refuse.has(fn)) return { data: null, error: { message: `${fn} refused` } };
      if (fn === 'waves_my_agent_writes') return { data: [], error: null };
      return { data: fn === 'waves_ensure_group_join_token' ? 'token' : randomUUID(), error: null };
    },
    functions: { invoke: async () => ({ data: {}, error: null }) },
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as unknown as SupabaseClient;
}

const group = randomUUID();
const me = randomUUID();
const other = randomUUID();

/**
 * One call to every write tool, shaped to reach its RPCs — `add_expense`
 * leaves the payer to default and names someone new, so both the payer
 * lookup and the ghost insert run.
 */
const WRITE_CALLS: { name: string; arguments: Record<string, unknown> }[] = [
  { name: 'create_group', arguments: { name: 'Goa', country: 'in' } },
  {
    name: 'add_expense',
    arguments: { groupId: group, description: 'Chai', amount: '20000', people: ['Matt'] },
  },
  {
    name: 'edit_expense',
    arguments: {
      groupId: group,
      expenseId: randomUUID(),
      baseVersionNo: 1,
      description: 'Chai',
      amount: '20000',
      paidBy: me,
      participants: [me, other],
    },
  },
  {
    name: 'add_expense_with_person',
    arguments: { person: 'Renny', description: 'Dinner', amount: '100000', paidBy: 'them' },
  },
  { name: 'delete_expense', arguments: { expenseId: randomUUID() } },
  {
    name: 'record_settlement',
    arguments: { groupId: group, fromMemberId: other, toMemberId: me, amount: '10000' },
  },
  { name: 'add_people', arguments: { groupId: group, names: ['Priya'] } },
  { name: 'invite_link', arguments: { groupId: group } },
];

/** The read tools that go through an RPC rather than a table, held to the same check. */
const READ_RPC_CALLS: { name: string; arguments: Record<string, unknown> }[] = [
  { name: 'list_agent_writes', arguments: {} },
];

async function readOnlyToolNames(): Promise<Set<string>> {
  const server = buildWavesServer(recordingSupabase([]), randomUUID(), true);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  await client.close();
  return new Set(tools.map((t) => t.name));
}

async function driveWriteTools(): Promise<RpcCall[]> {
  const calls: RpcCall[] = [];
  const server = buildWavesServer(recordingSupabase(calls), randomUUID(), false);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  // A write tool with no entry in WRITE_CALLS would slip past every check, so
  // the list has to cover whatever a read-only server leaves out.
  const all = (await client.listTools()).tools.map((t) => t.name);
  const reads = await readOnlyToolNames();
  expect(WRITE_CALLS.map((c) => c.name).sort()).toEqual(all.filter((t) => !reads.has(t)).sort());

  for (const call of [...WRITE_CALLS, ...READ_RPC_CALLS]) {
    const result = await client.callTool(call);
    expect(result.isError, `${call.name}: ${JSON.stringify(result.content)}`).toBeFalsy();
  }
  await client.close();

  // The clean-up path only runs when adding the person fails, so drive it on
  // its own: a new pair whose ghost is refused removes the group it made.
  const cleanup = buildWavesServer(
    recordingSupabase(calls, new Set(['waves_add_ghost_member'])),
    randomUUID(),
    false,
  );
  const [cleanupClient, cleanupServer] = InMemoryTransport.createLinkedPair();
  const second = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([cleanup.connect(cleanupServer), second.connect(cleanupClient)]);
  const refused = await second.callTool({
    name: 'add_expense_with_person',
    arguments: { person: 'Priya', description: 'Coffee', amount: '100' },
  });
  expect(refused.isError).toBe(true);
  await second.close();
  return calls;
}

describe('agent RPC calls against the migrated schema', () => {
  const signatures = liveSignatures();

  it('reads the signature that broke add_expense out of the migrations', () => {
    expect(resolves(signatures.get('waves_my_member_id_for'), ['p_group_id'])).toBe(false);
    expect(resolves(signatures.get('waves_my_member_id_for'), ['p_group_id', 'p_profile_id'])).toBe(
      true,
    );
  });

  it('every RPC a write tool sends matches exactly one live function', async () => {
    const calls = await driveWriteTools();

    const called = new Set(calls.map((c) => c.fn));
    const source = readFileSync(join(import.meta.dirname, 'tools.ts'), 'utf8');
    const inSource = new Set([...source.matchAll(/\.rpc\(\s*'(\w+)'/g)].map((m) => m[1]!));
    expect([...called].sort()).toEqual([...inSource].sort());

    for (const { fn, args } of calls) {
      expect(signatures.has(fn), `public.${fn} is not defined by any migration`).toBe(true);
      expect(
        resolves(signatures.get(fn), Object.keys(args)),
        `${fn}(${Object.keys(args).join(', ')}) matches no live signature: ${JSON.stringify([
          ...(signatures.get(fn)?.values() ?? []),
        ])}`,
      ).toBe(true);
    }
  });
});

describe('add_expense payer', () => {
  function payerLookup(members: Record<string, string>): SupabaseClient {
    return {
      rpc: async (_fn: string, args: Record<string, unknown>) => ({
        data: members[`${args.p_group_id}/${args.p_profile_id}`] ?? null,
        error: null,
      }),
    } as unknown as SupabaseClient;
  }

  it('defaults to the signed-in person when paidBy is omitted', async () => {
    const supabase = payerLookup({ 'group-1/profile-me': 'member-me' });

    const party = await expenseParty(supabase, 'profile-me', 'group-1', {
      participants: ['member-matt'],
    });

    expect(party.paidBy).toBe('member-me');
    expect(party.participants).toEqual(['member-matt', 'member-me']);
  });

  it('asks for paidBy when the signed-in person is not in the group', async () => {
    const supabase = payerLookup({});

    const party = await expenseParty(supabase, 'profile-me', 'group-1', {
      participants: ['member-matt'],
    });

    expect(Array.isArray(party.participants)).toBe(false);
    expect(JSON.stringify(party.participants)).toContain('say who paid with paidBy');
  });
});
