/**
 * Chaos injection for the voice functions, for live failure drills in
 * production — on named test accounts only.
 *
 * Two secrets, both required:
 *
 *   VOICE_CHAOS_ENABLED=1
 *   VOICE_CHAOS=deepgram-down,llm-slow        (comma list, see ChaosFlag)
 *
 * and even then a fault is injected only for a caller on
 * `voice_agent_allowlist`. Everyone else's request takes the exact normal path:
 * with either secret unset no allowlist read happens at all, and a caller not
 * on the allowlist gets no flags. Turning it off is unsetting either secret
 * (`supabase secrets unset VOICE_CHAOS_ENABLED`); see docs/voice-failure-modes.md.
 *
 * Faults are injected at the network edge — a fetch wrapper for Deepgram and
 * the LLM providers, and a hook in the relay — so the real timeout, breaker,
 * refund and fallback code is what gets exercised, not a stand-in.
 */

import type { SupabaseClient } from './auth.ts';

export const CHAOS_FLAGS = [
  /** Deepgram answers 503 (clip transcription) / refuses the upstream socket (relay). */
  'deepgram-down',
  /** Deepgram never answers: the clip call and the relay's upstream connect hang. */
  'deepgram-slow',
  /** Every LLM provider answers 503. */
  'llm-down',
  /** Every LLM provider hangs until the per-attempt deadline aborts it. */
  'llm-slow',
  /** Every LLM provider answers 200 with an unusable tool call. */
  'llm-garbage',
  /** The relay cuts a live stream (close 1011) about a second after Ready. */
  'relay-drop',
] as const;

export type ChaosFlag = (typeof CHAOS_FLAGS)[number];
export type Chaos = ReadonlySet<ChaosFlag>;

export const NO_CHAOS: Chaos = new Set();

/** The flags the secrets ask for, ignoring unknown names; empty unless enabled. */
export function parseChaos(env: (name: string) => string | undefined): Chaos {
  if (env('VOICE_CHAOS_ENABLED') !== '1') return NO_CHAOS;
  const known = new Set<string>(CHAOS_FLAGS);
  const flags = (env('VOICE_CHAOS') ?? '')
    .split(',')
    .map((flag) => flag.trim().toLowerCase())
    .filter((flag): flag is ChaosFlag => known.has(flag));
  return flags.length > 0 ? new Set(flags) : NO_CHAOS;
}

/**
 * The faults to inject for this caller: the configured flags when the caller is
 * on `voice_agent_allowlist`, else none. Fails closed — an allowlist read that
 * errors injects nothing.
 */
export async function chaosFor(
  env: (name: string) => string | undefined,
  service: SupabaseClient,
  profileId: string,
): Promise<Chaos> {
  const flags = parseChaos(env);
  if (flags.size === 0) return NO_CHAOS;
  try {
    const { data, error } = await service
      .from('voice_agent_allowlist')
      .select('profile_id')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (error || !data) return NO_CHAOS;
  } catch {
    return NO_CHAOS;
  }
  console.warn(JSON.stringify({ event: 'voice_chaos', flags: [...flags] }));
  return flags;
}

export type Upstream = 'deepgram' | 'llm' | 'other';

/** Which dependency a URL belongs to. */
export function upstreamOf(url: string): Upstream {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    return 'other';
  }
  if (host.endsWith('deepgram.com')) return 'deepgram';
  if (
    host === 'openrouter.ai' ||
    host === 'generativelanguage.googleapis.com' ||
    host === 'api.anthropic.com' ||
    host === 'api.deepseek.com'
  ) {
    return 'llm';
  }
  return 'other';
}

/** Never resolves; rejects with an AbortError when `signal` aborts. */
function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** A well-formed 200 whose only tool call names a tool that does not exist. */
function garbageFor(url: string): Response {
  const host = new URL(url).host;
  const body =
    host === 'generativelanguage.googleapis.com'
      ? {
          candidates: [
            { content: { parts: [{ functionCall: { name: 'chaos_tool', args: {} } }] } },
          ],
        }
      : host === 'api.anthropic.com'
        ? { content: [{ type: 'tool_use', id: 'chaos', name: 'chaos_tool', input: {} }] }
        : {
            choices: [
              {
                message: { tool_calls: [{ function: { name: 'chaos_tool', arguments: '{oops' } }] },
              },
            ],
          };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const unavailable = () =>
  new Response(JSON.stringify({ error: 'chaos: injected outage' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

/** `fetchFn` with the configured faults in front of Deepgram and the LLMs. */
export function chaosFetch(fetchFn: typeof fetch, chaos: Chaos): typeof fetch {
  if (chaos.size === 0) return fetchFn;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const target = upstreamOf(url);
    if (target === 'deepgram') {
      if (chaos.has('deepgram-down')) return Promise.resolve(unavailable());
      if (chaos.has('deepgram-slow')) return hang(init?.signal);
    }
    if (target === 'llm') {
      if (chaos.has('llm-down')) return Promise.resolve(unavailable());
      if (chaos.has('llm-slow')) return hang(init?.signal);
      if (chaos.has('llm-garbage')) return Promise.resolve(garbageFor(url));
    }
    return fetchFn(input, init);
  }) as typeof fetch;
}
