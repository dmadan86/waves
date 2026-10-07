/**
 * voice-agent — Pro "advanced voice" (A73 phase 1, server half).
 *
 * One request: a short clip in, proposed actions out. Deepgram transcribes it,
 * Claude (tool use) turns the transcript into actions against the caller's own
 * groups and members, and every action is validated here before it is returned.
 * Nothing is written: the app confirms each action and runs it through its own
 * write paths ("AI proposes, human confirms", ADR-008). No audio is stored; the
 * bytes go to Deepgram and are dropped, and only metadata is logged.
 *
 * Dependencies are injected so the whole flow can be driven in a test.
 */

import {
  VOICE_AGENT_FREE_MONTHLY,
  VOICE_AGENT_MAX_CLIP_MS,
  VOICE_AGENT_PRO_MONTHLY,
  VOICE_AGENT_SCHEMA_VERSION,
  VoiceAgentError,
  type VoiceAgentRequest,
  type VoiceAgentResponse,
} from '../_shared/core.js';
import { HttpError, json, type SupabaseClient } from '../_shared/auth.ts';
import {
  buildContext,
  deepgramUrl,
  keyterms,
  parseToolCalls,
  systemPrompt,
  TOOLS,
  type Parsed,
  type RawBalance,
  type RawGroup,
  type RawMember,
  type ToolCall,
  type VoiceContext,
} from './logic.ts';

export const PRIMARY_MODEL = 'claude-haiku-4-5-20251001';
export const ESCALATION_MODEL = 'claude-sonnet-5-5';

/** ~12 MB of audio. A 60 s clip is a fraction of this in any accepted format. */
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export interface Deps {
  readonly env: (name: string) => string | undefined;
  readonly caller: SupabaseClient;
  readonly service: SupabaseClient;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  /** Throws a 429 HttpError when the caller is going too fast. */
  readonly rateLimit: (profileId: string) => Promise<void>;
}

interface Quota {
  used: number;
  limit: number;
  tier: 'free' | 'plus' | 'pro';
  allowed: boolean;
}

export async function handleVoiceAgent(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
  const started = deps.now();
  const body = parseBody(await request.json().catch(() => null));

  const { data: userData, error: userError } = await deps.caller.auth.getUser();
  if (userError || !userData?.user) throw new HttpError(401, 'NOT_AUTHENTICATED', 'Sign in first');
  const profileId = userData.user.id as string;

  const unavailable = (message: string) => new HttpError(503, VoiceAgentError.Unavailable, message);

  // Flag first: when the feature is off for this person nothing else about the
  // request should be observable, not even a quota or rate-limit answer.
  const { data: enabled, error: flagError } = await deps.service.rpc('waves_voice_agent_enabled', {
    p_profile: profileId,
  });
  if (flagError || enabled !== true) throw unavailable('Advanced voice is not available');

  const deepgramKey = deps.env('DEEPGRAM_API_KEY');
  const anthropicKey = deps.env('ANTHROPIC_API_KEY');
  if (!deepgramKey || !anthropicKey) throw unavailable('Advanced voice is not configured');

  await deps.rateLimit(profileId);

  if (
    body.durationMs > VOICE_AGENT_MAX_CLIP_MS ||
    body.audioBase64.length * 0.75 > MAX_AUDIO_BYTES
  ) {
    throw new HttpError(413, VoiceAgentError.ClipTooLong, 'That clip is too long');
  }

  // Quota before any provider spend; refunded if the providers then fail.
  const { data: quotaData, error: quotaError } = await deps.service.rpc('waves_voice_agent_quota', {
    p_profile: profileId,
    p_free_limit: VOICE_AGENT_FREE_MONTHLY,
    p_pro_limit: VOICE_AGENT_PRO_MONTHLY,
  });
  if (quotaError || !quotaData) throw unavailable('Advanced voice is not available');
  const quota = quotaData as Quota;
  if (!quota.allowed) {
    throw new HttpError(402, VoiceAgentError.QuotaReached, 'Advanced voice allowance used up');
  }

  try {
    const context = await loadContext(deps.caller, profileId, body);
    const transcript = await transcribe(deps, deepgramKey, body, context);
    if (!transcript) {
      throw new HttpError(422, VoiceAgentError.NothingHeard, 'Nothing was heard');
    }

    let model = PRIMARY_MODEL;
    let parsed = await ask(deps, anthropicKey, model, context, transcript);
    let escalated = false;
    if (!parsed.ok) {
      escalated = true;
      model = ESCALATION_MODEL;
      parsed = await ask(deps, anthropicKey, model, context, transcript);
    }

    const response: VoiceAgentResponse = parsed.ok
      ? {
          schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
          transcript,
          actions: parsed.actions,
          ...(parsed.answer ? { answer: parsed.answer } : {}),
          ...(parsed.clarify ? { clarify: parsed.clarify } : {}),
          quota: { used: quota.used, limit: quota.limit, tier: quota.tier },
        }
      : {
          schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
          transcript,
          actions: [],
          clarify: "Sorry, I didn't catch what to do with that. Could you say it again?",
          quota: { used: quota.used, limit: quota.limit, tier: quota.tier },
        };

    // Metadata only: never the audio, the transcript or any name.
    console.log(
      JSON.stringify({
        fn: 'voice-agent',
        durationMs: body.durationMs,
        latencyMs: deps.now() - started,
        tier: quota.tier,
        model,
        escalated,
        valid: parsed.ok,
        actions: response.actions.map((a) => a.type),
      }),
    );
    return json(response);
  } catch (error) {
    // The person got nothing for the command: give it back.
    await deps.service.rpc('waves_voice_agent_refund', { p_profile: profileId }).catch(() => null);
    throw error;
  }
}

function parseBody(raw: unknown): VoiceAgentRequest {
  const b = raw as Partial<VoiceAgentRequest> | null;
  if (
    !b ||
    b.schemaVersion !== VOICE_AGENT_SCHEMA_VERSION ||
    typeof b.audioBase64 !== 'string' ||
    b.audioBase64.length === 0 ||
    typeof b.mimeType !== 'string' ||
    typeof b.durationMs !== 'number' ||
    !Number.isFinite(b.durationMs) ||
    b.durationMs <= 0 ||
    typeof b.locale !== 'string' ||
    typeof b.today !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.today)
  ) {
    throw new HttpError(400, 'BAD_REQUEST', 'Malformed voice request');
  }
  return b as VoiceAgentRequest;
}

/** The caller's groups, members and balances, read as the caller (RLS-scoped). */
async function loadContext(
  caller: SupabaseClient,
  profileId: string,
  body: VoiceAgentRequest,
): Promise<VoiceContext> {
  const { data: groups, error: groupsError } = await caller
    .from('groups')
    .select('id, name, type, default_currency')
    .is('deleted_at', null)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(30);
  if (groupsError) throw new HttpError(500, 'INTERNAL', groupsError.message);
  const rawGroups = (groups ?? []) as RawGroup[];
  const ids = rawGroups.map((g) => g.id);
  if (ids.length === 0) {
    return buildContext({
      groups: [],
      members: [],
      balances: [],
      meProfileId: profileId,
      currentGroupId: body.groupId,
      today: body.today,
    });
  }

  const [members, balances] = await Promise.all([
    caller
      .from('group_members')
      .select('id, group_id, profile_id, ghost_name, profile:profiles!profile_id ( display_name )')
      .in('group_id', ids)
      .is('left_at', null)
      .order('created_at', { ascending: true }),
    caller
      .from('group_balances')
      .select('group_id, member_id, currency, balance')
      .in('group_id', ids),
  ]);
  if (members.error) throw new HttpError(500, 'INTERNAL', members.error.message);
  // Balances are a nicety: a failure there must not lose the command.
  return buildContext({
    groups: rawGroups,
    members: (members.data ?? []) as RawMember[],
    balances: (balances.error ? [] : (balances.data ?? [])) as RawBalance[],
    meProfileId: profileId,
    currentGroupId: body.groupId,
    today: body.today,
  });
}

async function transcribe(
  deps: Deps,
  key: string,
  body: VoiceAgentRequest,
  context: VoiceContext,
): Promise<string> {
  let audio: Uint8Array;
  try {
    const binary = atob(body.audioBase64);
    audio = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Audio is not valid base64');
  }
  const response = await deps.fetch(deepgramUrl(body.locale, keyterms(context)), {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': body.mimeType },
    body: new Blob([audio]),
  });
  if (!response.ok) {
    console.error('deepgram error', response.status);
    throw new HttpError(502, 'VOICE_AGENT_FAILED', 'Speech recognition failed just now');
  }
  const result = (await response.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  return (result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();
}

async function ask(
  deps: Deps,
  key: string,
  model: string,
  context: VoiceContext,
  transcript: string,
): Promise<Parsed> {
  const response = await deps.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: systemPrompt(context),
      tools: TOOLS,
      // Always a tool: an answer, a question or an action, never free text.
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: transcript }],
    }),
  });
  if (!response.ok) {
    console.error('anthropic error', response.status);
    throw new HttpError(502, 'VOICE_AGENT_FAILED', 'The assistant could not answer just now');
  }
  const message = (await response.json()) as {
    content?: { type: string; name?: string; input?: unknown }[];
  };
  const calls: ToolCall[] = (message.content ?? [])
    .filter((block) => block.type === 'tool_use' && typeof block.name === 'string')
    .map((block) => ({ name: block.name as string, input: block.input }));
  return parseToolCalls(calls, context);
}
