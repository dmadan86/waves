/**
 * A small voice-agent harness for the abuse tests: stubbed Supabase, Deepgram
 * and one OpenRouter model, with every RPC recorded.
 */

import { vi } from 'vitest';

import type { Deps } from '../../voice-agent/handler.ts';
import { WAV_CLIP } from '../test/audio.ts';

export const ME = 'profile-me';

export type FetchImpl = (url: string, init: RequestInit) => Response | Promise<Response>;

function table(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'order', 'limit', 'in', 'eq']) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}

export interface Quota {
  used: number;
  limit: number;
  tier: 'free' | 'pro';
  trial?: boolean;
  until?: string;
  allowed: boolean;
  month?: string;
  reason?: string;
}

export interface Over {
  fetchImpl?: FetchImpl;
  quota?: Quota | ((call: number) => Quota);
  followup?: Record<string, unknown>;
  groupsError?: boolean;
  env?: Record<string, string>;
}

export function makeDeps(over: Over = {}) {
  let quotaCalls = 0;
  const rpc = vi.fn(async (name: string) => {
    if (name === 'waves_voice_agent_enabled') return { data: true, error: null };
    if (name === 'waves_voice_agent_quota') {
      quotaCalls += 1;
      const q =
        typeof over.quota === 'function'
          ? over.quota(quotaCalls)
          : (over.quota ?? { used: 3, limit: 100, tier: 'pro', allowed: true, month: '2026-10' });
      return { data: q, error: null };
    }
    if (name === 'waves_voice_agent_followup') {
      return {
        data: over.followup ?? {
          used: 1,
          limit: 300,
          tier: 'pro',
          allowed: true,
          month: '2026-10',
        },
        error: null,
      };
    }
    if (name === 'waves_voice_agent_followup_open') return { data: 'slot-1', error: null };
    return { data: 0, error: null };
  });
  const tables: Record<string, unknown[]> = {
    groups: [{ id: 'g1', name: 'Goa', type: 'trip', default_currency: 'INR' }],
    group_members: [
      {
        id: 'm-me',
        group_id: 'g1',
        profile_id: ME,
        ghost_name: null,
        profile: { display_name: 'Madan' },
      },
      { id: 'm-anu', group_id: 'g1', profile_id: null, ghost_name: 'Anu', profile: null },
    ],
    group_balances: [],
    expenses: [],
  };
  const fetchMock = vi.fn(over.fetchImpl ?? (async () => new Response('{}')));
  const deps = {
    env: (n: string) => ({ DEEPGRAM_API_KEY: 'dg', OPENROUTER_API_KEY: 'or', ...over.env })[n],
    caller: {
      auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
      from: (t: string) => {
        if (t === 'groups' && over.groupsError) {
          const q = table([]);
          q.then = (resolve: (v: unknown) => unknown) =>
            resolve({ data: null, error: { message: 'statement timeout' } });
          return q;
        }
        return table(tables[t] ?? []);
      },
    },
    service: {
      rpc,
      from: () => {
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'eq']) q[m] = () => q;
        q.maybeSingle = async () => ({ data: null, error: null });
        return q;
      },
    },
    fetch: fetchMock as unknown as typeof fetch,
    now: () => 0,
    rateLimit: async () => undefined,
  } as unknown as Deps;
  return { deps, rpc, fetchMock };
}

export const refunds = (rpc: ReturnType<typeof makeDeps>['rpc']) =>
  rpc.mock.calls.filter(([n]) => n === 'waves_voice_agent_refund').map(([, args]) => args);

export const deepgram = (transcript: string, duration?: number) =>
  new Response(
    JSON.stringify({
      ...(duration === undefined ? {} : { metadata: { duration } }),
      results: { channels: [{ alternatives: [{ transcript }] }] },
    }),
  );

/** One OpenRouter answer carrying these tool calls. */
export const openrouter = (calls: { name: string; input: unknown }[]) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            tool_calls: calls.map((c) => ({
              function: { name: c.name, arguments: JSON.stringify(c.input) },
            })),
          },
        },
      ],
    }),
  );

export const goodExpense = {
  groupId: 'g1',
  description: 'Dinner',
  amountMinor: '120000',
  currency: 'INR',
  paidByMemberId: 'm-me',
  split: { mode: 'equal', shares: [{ memberId: 'm-me' }, { memberId: 'm-anu' }] },
};

export const route =
  (transcript: string, calls: { name: string; input: unknown }[], duration?: number): FetchImpl =>
  (url) =>
    String(url).includes('deepgram') ? deepgram(transcript, duration) : openrouter(calls);

export const textRequest = (extra: Record<string, unknown> = {}) =>
  new Request('https://x/voice-agent', {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: 1,
      transcript: 'I paid 1200 for dinner with Anu',
      locale: 'en',
      today: '2026-10-07',
      groupId: 'g1',
      ...extra,
    }),
  });

export const clipRequest = (extra: Record<string, unknown> = {}) =>
  new Request('https://x/voice-agent', {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: 1,
      audioBase64: WAV_CLIP,
      mimeType: 'audio/wav',
      durationMs: 4000,
      locale: 'en',
      today: '2026-10-07',
      groupId: 'g1',
      ...extra,
    }),
  });

export { base64, wavBytes } from '../test/audio.ts';
