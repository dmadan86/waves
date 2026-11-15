/**
 * The consent page's company picker lists only companies where agents are switched on, and a failed binding stops
 * the approval before it happens.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { bindAssistant, loadAgentCompanies } from '@/lib/agentCompanies';

function fakeClient(rows: unknown[], rpcError: string | null = null) {
  const filters: unknown[][] = [];
  const rpcs: unknown[][] = [];
  const query: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
  };
  for (const m of ['select', 'eq', 'is', 'order'])
    query[m] = (...args: unknown[]) => {
      filters.push([m, ...args]);
      return query;
    };
  const client = {
    from: () => query,
    rpc: async (...args: unknown[]) => {
      rpcs.push(args);
      return { error: rpcError ? { message: rpcError } : null };
    },
  } as unknown as SupabaseClient;
  return { client, filters, rpcs };
}

describe('the company picker', () => {
  it('asks only for live companies with agents switched on', async () => {
    const { client, filters } = fakeClient([{ id: 'c1', name: 'Asha Works' }]);
    expect(await loadAgentCompanies(client)).toEqual([{ id: 'c1', name: 'Asha Works' }]);
    expect(filters).toEqual(
      expect.arrayContaining([
        ['eq', 'type', 'company'],
        ['eq', 'company_agents_enabled', true],
        ['is', 'deleted_at', null],
        ['is', 'suspended_at', null],
      ]),
    );
  });

  it('names an unnamed company rather than showing a blank row', async () => {
    const { client } = fakeClient([{ id: 'c2', name: null }]);
    expect((await loadAgentCompanies(client))[0]!.name).toBe('—');
  });

  it('is empty (and so the picker is not shown) when no company allows agents', async () => {
    expect(await loadAgentCompanies(fakeClient([]).client)).toEqual([]);
  });
});

describe('binding', () => {
  it('sends the company and the client id, or null to unbind', async () => {
    const f = fakeClient([]);
    await bindAssistant(f.client, 'client_1', 'c1');
    await bindAssistant(f.client, 'client_1', null);
    expect(f.rpcs).toEqual([
      ['waves_company_agent_link', { p_group_id: 'c1', p_client_id: 'client_1' }],
      ['waves_company_agent_link', { p_group_id: null, p_client_id: 'client_1' }],
    ]);
  });

  it('throws when the database refuses, so the page does not approve', async () => {
    await expect(
      bindAssistant(fakeClient([], 'AGENTS_OFF').client, 'client_1', 'c1'),
    ).rejects.toMatchObject({ message: 'AGENTS_OFF' });
  });
});
