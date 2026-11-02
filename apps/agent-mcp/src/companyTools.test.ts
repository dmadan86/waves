/**
 * The company tools, driven through a real MCP client.
 *
 * The property that matters is the order: the gate is the first thing every tool does, and when it refuses nothing
 * else happens - no read, no write, no audit row. After that, a write is capped, made through the company RPC the app
 * itself uses, and recorded; a refusal from the RPC (an employee writing for a colleague) records nothing.
 */

import { randomUUID } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { buildWavesServer } from './tools';

const COMPANY = randomUUID();
const MEMBER = randomUUID();
const OTHER = randomUUID();

type Log = string[];

function fake(opts: { role?: string; gateError?: string; rpcError?: Record<string, string>; existing?: unknown[]; rpcResult?: Record<string, unknown> } = {}) {
  const log: Log = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    log.push(`from:${table}`);
    const rows =
      table === 'groups'
        ? [{ id: COMPANY, name: 'Asha Works', type: 'company', default_currency: 'INR', company_approvals_enabled: false, company_agent_approval: true }]
        : table === 'company_entries'
          ? (opts.existing ?? [])
          : [];
    const query: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    for (const m of ['select', 'eq', 'neq', 'is', 'gte', 'lte', 'order', 'limit', 'ilike']) query[m] = () => query;
    return query;
  };
  const client = {
    from,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      log.push(`rpc:${fn}`);
      rpcs.push({ fn, args });
      if (fn === 'waves_company_agent_gate') {
        return opts.gateError
          ? { data: null, error: { message: opts.gateError } }
          : { data: opts.role ?? 'admin', error: null };
      }
      if (opts.rpcError?.[fn]) return { data: null, error: { message: opts.rpcError[fn] } };
      return { data: opts.rpcResult?.[fn] ?? [], error: null };
    },
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as unknown as SupabaseClient;
  return { client, log, rpcs };
}

async function connect(supabase: SupabaseClient, readOnly = false) {
  const server = buildWavesServer(supabase, 'me', readOnly);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}
async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>) {
  const client = await connect(supabase);
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  const text = (result.content as { text: string }[])[0]?.text ?? '';
  return { isError: Boolean(result.isError), text };
}

const entry = {
  companyId: COMPANY,
  member: MEMBER,
  amount: '12500',
  category: 'fuel',
  occurredOn: '2026-11-01',
};
const CALLS: Record<string, Record<string, unknown>> = {
  company_overview: { companyId: COMPANY },
  list_company_people: { companyId: COMPANY },
  list_company_entries: { companyId: COMPANY },
  list_attendance: { companyId: COMPANY, from: '2026-11-01', to: '2026-11-07' },
  list_work_tasks: { companyId: COMPANY },
  list_clients: { companyId: COMPANY },
  list_company_agent_writes: { companyId: COMPANY },
  add_company_entry: entry,
  set_attendance: { companyId: COMPANY, member: MEMBER, day: '2026-11-01', status: 'present' },
  set_work_task: { companyId: COMPANY, member: MEMBER, day: '2026-11-01', title: 'Visit' },
  upsert_client: { companyId: COMPANY, name: 'Asha' },
  save_estimate_draft: {
    companyId: COMPANY,
    customerName: 'Asha',
    docDate: '2026-11-01',
    items: [{ description: 'Paint', qtyMilli: '2000', rateMinor: '50000' }],
  },
};

describe('every company tool opens with the gate', () => {
  for (const [name, args] of Object.entries(CALLS)) {
    it(`${name}: a refusal stops everything else`, async () => {
      const { client, log } = fake({ gateError: 'AGENTS_OFF: AI agents are switched off for this company' });
      const result = await call(client, name, args);
      expect(result.isError).toBe(true);
      expect(result.text).toContain('AGENTS_OFF');
      expect(log).toEqual(['rpc:waves_company_agent_gate']);
    });

    it(`${name}: asks the gate about the company it was given, first`, async () => {
      const f = fake();
      await call(f.client, name, args);
      expect(f.log[0]).toBe('rpc:waves_company_agent_gate');
      expect(f.rpcs[0]!.args).toEqual({ p_group_id: COMPANY });
    });
  }
});

describe('read-only connections', () => {
  it('get the company reads and none of the writes', async () => {
    const client = await connect(fake().client, true);
    const names = (await client.listTools()).tools.map((t) => t.name);
    await client.close();
    for (const read of ['company_overview', 'list_company_people', 'list_company_entries', 'list_attendance', 'list_work_tasks', 'list_clients', 'list_company_agent_writes'])
      expect(names).toContain(read);
    for (const write of ['add_company_entry', 'set_attendance', 'set_work_task', 'upsert_client', 'save_estimate_draft'])
      expect(names).not.toContain(write);
  });
});

describe('writes', () => {
  it('add_company_entry: gates, then one RPC does cap, write and audit together', async () => {
    const f = fake({ rpcResult: { waves_company_agent_entry_add: 'submitted' } });
    const result = await call(f.client, 'add_company_entry', { ...entry, entryId: OTHER });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ status: 'submitted', waitingForApproval: true });
    expect(f.rpcs.map((r) => r.fn)).toEqual(['waves_company_agent_gate', 'waves_company_agent_entry_add']);
    expect(f.rpcs[1]!.args).toMatchObject({
      p_group_id: COMPANY,
      p_entry_id: OTHER,
      p_member_id: MEMBER,
      p_data: { amount: '12500', category: 'fuel' },
    });
  });

  it('add_company_entry: a refusal (cap, or an employee writing for a colleague) surfaces as an error', async () => {
    for (const message of ['AGENT_CAP_SINGLE: too large', 'NOT_ALLOWED']) {
      const f = fake({ role: 'member', rpcError: { waves_company_agent_entry_add: message } });
      const result = await call(f.client, 'add_company_entry', entry);
      expect(result.isError).toBe(true);
      expect(result.text).toContain(message);
    }
  });

  it.each([
    ['set_attendance', 'waves_company_attendance_set', 'attendance.set'],
    ['set_work_task', 'waves_company_work_set', 'work_task.set'],
    ['upsert_client', 'waves_company_client_set', 'client.save'],
  ])('%s records an agent write after %s', async (tool, rpc, action) => {
    const f = fake();
    const result = await call(f.client, tool, CALLS[tool]!);
    expect(result.isError).toBe(false);
    const fns = f.rpcs.map((r) => r.fn);
    expect(fns[0]).toBe('waves_company_agent_gate');
    expect(fns.indexOf(rpc)).toBeGreaterThan(0);
    expect(f.rpcs.at(-1)).toMatchObject({ fn: 'waves_record_agent_write', args: { p_action: action, p_group_id: COMPANY } });
  });

  it('save_estimate_draft: one RPC enforces draft-only, cap and audit', async () => {
    const f = fake({ rpcResult: { waves_company_agent_estimate_save: '100000' } });
    const result = await call(f.client, 'save_estimate_draft', CALLS.save_estimate_draft!);
    expect(JSON.parse(result.text)).toMatchObject({ status: 'draft', totalMinor: '100000' });
    expect(f.rpcs.map((r) => r.fn)).toEqual(['waves_company_agent_gate', 'waves_company_agent_estimate_save']);
  });

  it('employees cannot mark attendance, save clients or estimates (no RPC is called)', async () => {
    for (const tool of ['set_attendance', 'upsert_client', 'save_estimate_draft', 'list_clients', 'list_company_agent_writes']) {
      const f = fake({ role: 'member' });
      const result = await call(f.client, tool, CALLS[tool]!);
      expect(result.isError, tool).toBe(true);
      expect(f.rpcs.map((r) => r.fn), tool).toEqual(['waves_company_agent_gate']);
    }
  });
});

describe('personal tools and company groups', () => {
  it('every personal tool that takes a groupId refuses a company id, reads included', async () => {
    const client = await connect(fake().client);
    const tools = (await client.listTools()).tools.filter(
      (t) => ((t.inputSchema as { required?: string[] }).required ?? []).join() === 'groupId',
    );
    await client.close();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['list_members', 'get_balances', 'list_expenses', 'invite_link']));
    for (const tool of tools) {
      const f = fake();
      const result = await call(f.client, tool.name, { groupId: COMPANY });
      expect(result.isError, tool.name).toBe(true);
      expect(result.text, tool.name).toContain('company');
      expect(f.rpcs, tool.name).toEqual([]);
    }
  });
});
