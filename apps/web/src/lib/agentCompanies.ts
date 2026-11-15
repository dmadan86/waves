/**
 * The companies a person may bind an assistant to at consent time.
 *
 * Only companies where they are an active member (what RLS lets them read) AND the owner has switched AI agents on.
 * A suspended or deleted company is left out. The binding itself is made by `waves_company_agent_link`, which checks
 * all of this again - this list is the courtesy, the RPC is the rule.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AgentCompany {
  id: string;
  name: string;
}

export async function loadAgentCompanies(client: SupabaseClient): Promise<AgentCompany[]> {
  const { data, error } = await client
    .from('groups')
    .select('id, name')
    .eq('type', 'company')
    .eq('company_agents_enabled', true)
    .is('deleted_at', null)
    .is('suspended_at', null)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((g) => ({ id: String(g.id), name: String(g.name ?? '').trim() || '—' }));
}

/** Bind (or, with no company, unbind) the assistant. Must succeed before the authorization is approved. */
export async function bindAssistant(
  client: SupabaseClient,
  clientId: string,
  companyId: string | null,
): Promise<void> {
  const { error } = await client.rpc('waves_company_agent_link', {
    p_group_id: companyId,
    p_client_id: clientId,
  });
  if (error) throw error;
}
