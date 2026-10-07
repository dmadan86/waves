/**
 * The stream-token gate: flag first, then the key, then a minted Deepgram token
 * and the live URL carrying the caller's names as keyterms.
 */

import { describe, expect, it, vi } from 'vitest';

import { handleVoiceStreamToken, type Deps } from './handler.ts';

const ME = 'profile-me';

function table(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'is', 'order', 'limit', 'in']) q[m] = chain;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}

function makeDeps(over: { enabled?: boolean; env?: Record<string, string>; grant?: Response }) {
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
      { id: 'm-renny', group_id: 'g1', profile_id: null, ghost_name: 'Renny', profile: null },
    ],
    group_balances: [],
  };
  const fetchMock = vi.fn(
    async () =>
      over.grant ?? new Response(JSON.stringify({ access_token: 'tmp-token', expires_in: 60 })),
  );
  const deps: Deps = {
    env: (n) => ({ DEEPGRAM_API_KEY: 'dg', ...over.env })[n],
    caller: {
      auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
      from: (t: string) => table(tables[t] ?? []),
    } as never,
    service: { rpc: async () => ({ data: over.enabled ?? true, error: null }) } as never,
    fetch: fetchMock as unknown as typeof fetch,
    rateLimit: async () => undefined,
  };
  return { deps, fetchMock };
}

const request = () =>
  new Request('https://x/voice-stream-token', {
    method: 'POST',
    body: JSON.stringify({ locale: 'en', groupId: 'g1' }),
  });

describe('handleVoiceStreamToken', () => {
  it('503s when the feature is off, before minting anything', async () => {
    const { deps, fetchMock } = makeDeps({ enabled: false });
    await expect(handleVoiceStreamToken(request(), deps)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('503s when the key cannot mint tokens', async () => {
    const { deps } = makeDeps({ grant: new Response('{}', { status: 403 }) });
    await expect(handleVoiceStreamToken(request(), deps)).rejects.toMatchObject({
      status: 503,
      code: 'VOICE_AGENT_UNAVAILABLE',
    });
  });

  it('returns a token and a live URL with names as keyterms', async () => {
    const { deps } = makeDeps({});
    const body = (await (await handleVoiceStreamToken(request(), deps)).json()) as {
      token: string;
      url: string;
      sampleRate: number;
    };
    expect(body.token).toBe('tmp-token');
    expect(body.sampleRate).toBe(16000);
    expect(body.url).toMatch(/^wss:\/\/api\.deepgram\.com\/v1\/listen\?/);
    expect(body.url).toContain('encoding=linear16');
    expect(body.url).toContain('numerals=true');
    expect(body.url).toContain('keyterm=Renny');
  });
});
