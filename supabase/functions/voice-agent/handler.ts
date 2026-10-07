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
  userMessage,
  type Parsed,
  type RawBalance,
  type RawGroup,
  type RawMember,
  type ToolCall,
  type VoiceContext,
} from './logic.ts';

export const PRIMARY_MODEL = 'claude-haiku-4-5-20251001';
export const ESCALATION_MODEL = 'claude-sonnet-5-5';
export const DEEPSEEK_PRIMARY_MODEL = 'deepseek-flash';
export const DEEPSEEK_ESCALATION_MODEL = 'deepseek-v4-pro';
/** Flash-Lite first (about a second for one tool call); Flash when a key cannot reach Lite. */
export const GEMINI_MODEL = 'gemini-flash-lite-latest';
export const GEMINI_FALLBACK_MODEL = 'gemini-flash-latest';
/**
 * Through OpenRouter (one key, many vendors), picked by a bench of real Waves
 * commands on 7 Oct 2026: both 6/6, about 1.7 s median. Override with
 * `OPENROUTER_MODELS` (comma-separated) to try others without a deploy.
 */
export const OPENROUTER_MODELS = ['google/gemini-3.5-flash-lite', 'google/gemini-3.1-flash-lite'];

/** One model to ask, in the order the chain tries them. */
export interface LlmStep {
  readonly provider: 'anthropic' | 'deepseek' | 'gemini' | 'openrouter';
  readonly model: string;
  readonly key: string;
}

/**
 * Which models to ask, in order. `VOICE_LLM_PROVIDER` picks the lead
 * (`deepseek` or `anthropic`); without it DeepSeek leads when its key is set.
 * Each provider contributes its fast model then its stronger one, and the other
 * provider (when its key is set) follows as the fallback. At most three asks —
 * the person is waiting.
 */
export function llmChain(env: (name: string) => string | undefined): LlmStep[] {
  const deepseek = env('DEEPSEEK_API_KEY');
  const anthropic = env('ANTHROPIC_API_KEY');
  const ds: LlmStep[] = deepseek
    ? [
        { provider: 'deepseek', model: DEEPSEEK_PRIMARY_MODEL, key: deepseek },
        { provider: 'deepseek', model: DEEPSEEK_ESCALATION_MODEL, key: deepseek },
      ]
    : [];
  const an: LlmStep[] = anthropic
    ? [
        { provider: 'anthropic', model: PRIMARY_MODEL, key: anthropic },
        { provider: 'anthropic', model: ESCALATION_MODEL, key: anthropic },
      ]
    : [];
  const gemini = env('GEMINI_API_KEY');
  const ge: LlmStep[] = gemini
    ? [
        { provider: 'gemini', model: GEMINI_MODEL, key: gemini },
        { provider: 'gemini', model: GEMINI_FALLBACK_MODEL, key: gemini },
      ]
    : [];
  const openrouter = env('OPENROUTER_API_KEY');
  const orModels = (env('OPENROUTER_MODELS') ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const or: LlmStep[] = openrouter
    ? (orModels.length > 0 ? orModels : OPENROUTER_MODELS).map((model) => ({
        provider: 'openrouter' as const,
        model,
        key: openrouter,
      }))
    : [];
  const lead =
    env('VOICE_LLM_PROVIDER') ??
    (openrouter ? 'openrouter' : gemini ? 'gemini' : deepseek ? 'deepseek' : 'anthropic');
  const ordered =
    lead === 'anthropic'
      ? [...an, ...or, ...ge, ...ds]
      : lead === 'deepseek'
        ? [...ds, ...or, ...ge, ...an]
        : lead === 'gemini'
          ? [...ge, ...or, ...ds, ...an]
          : [...or, ...ge, ...ds, ...an];
  return ordered.slice(0, 3);
}

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
  const chain = llmChain(deps.env);
  if (!deepgramKey || chain.length === 0) throw unavailable('Advanced voice is not configured');

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

    // Down the chain until an answer validates against the context. A provider
    // that errors is skipped like one that answered badly; only when every step
    // failed outright does the request fail (and the command is refunded).
    const message = userMessage({
      cloud: transcript,
      device: body.deviceTranscript,
      followUp: body.followUp,
    });
    let parsed: Parsed | null = null;
    let model = chain[0].model;
    let lastError: unknown = null;
    for (const [index, step] of chain.entries()) {
      try {
        const attempt = await ask(deps, step, context, message);
        model = step.model;
        parsed = attempt;
        if (attempt.ok) break;
      } catch (error) {
        lastError = error;
        if (index === chain.length - 1 && !parsed) throw error;
      }
    }
    if (!parsed) throw lastError ?? new HttpError(502, 'VOICE_AGENT_FAILED', 'No answer');
    const escalated = model !== chain[0].model;

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
    !/^\d{4}-\d{2}-\d{2}$/.test(b.today) ||
    (b.deviceTranscript !== undefined && typeof b.deviceTranscript !== 'string') ||
    (b.followUp !== undefined &&
      (typeof b.followUp?.transcript !== 'string' || typeof b.followUp?.question !== 'string'))
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
  step: LlmStep,
  context: VoiceContext,
  transcript: string,
): Promise<Parsed> {
  const calls =
    step.provider === 'deepseek' || step.provider === 'openrouter'
      ? await askDeepSeek(deps, step, context, transcript)
      : step.provider === 'gemini'
        ? await askGemini(deps, step, context, transcript)
        : await askAnthropic(deps, step, context, transcript);
  return parseToolCalls(calls, context);
}

async function askAnthropic(
  deps: Deps,
  step: LlmStep,
  context: VoiceContext,
  transcript: string,
): Promise<ToolCall[]> {
  const response = await deps.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': step.key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: step.model,
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
  return (message.content ?? [])
    .filter((block) => block.type === 'tool_use' && typeof block.name === 'string')
    .map((block) => ({ name: block.name as string, input: block.input }));
}

/** The same tools in the OpenAI-style shape DeepSeek's and OpenRouter's APIs take. */
export const DEEPSEEK_TOOLS = TOOLS.map((tool) => ({
  type: 'function' as const,
  function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
}));

async function askDeepSeek(
  deps: Deps,
  step: LlmStep,
  context: VoiceContext,
  transcript: string,
): Promise<ToolCall[]> {
  const request = (lowEffort: boolean) =>
    deps.fetch(
      step.provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.deepseek.com/chat/completions',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${step.key}`,
          'content-type': 'application/json',
          ...(step.provider === 'openrouter' ? { 'x-title': 'Waves voice' } : {}),
        },
        body: JSON.stringify({
          model: step.model,
          max_tokens: 2000,
          // A short tool call, not an essay: light reasoning keeps it quick.
          ...(lowEffort
            ? step.provider === 'openrouter'
              ? { reasoning: { effort: 'low' } }
              : { reasoning_effort: 'low' }
            : {}),
          tools: DEEPSEEK_TOOLS,
          tool_choice: 'required',
          messages: [
            { role: 'system', content: systemPrompt(context) },
            { role: 'user', content: transcript },
          ],
        }),
      },
    );
  let response = await request(true);
  // An API that does not know the effort knob says so with a 400; ask plainly.
  if (response.status === 400) response = await request(false);
  if (!response.ok) {
    console.error(`${step.provider} error`, response.status);
    throw new HttpError(502, 'VOICE_AGENT_FAILED', 'The assistant could not answer just now');
  }
  const completion = (await response.json()) as {
    choices?: {
      message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] };
    }[];
  };
  const calls = completion.choices?.[0]?.message?.tool_calls ?? [];
  return calls
    .filter((call) => typeof call.function?.name === 'string')
    .map((call) => {
      let input: unknown = {};
      try {
        input = JSON.parse(call.function?.arguments ?? '{}');
      } catch {
        input = {};
      }
      return { name: call.function?.name as string, input };
    });
}

/** The same tools as Gemini function declarations. */
export const GEMINI_TOOLS = [
  {
    functionDeclarations: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    })),
  },
];

async function askGemini(
  deps: Deps,
  step: LlmStep,
  context: VoiceContext,
  transcript: string,
): Promise<ToolCall[]> {
  const response = await deps.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${step.model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': step.key, 'content-type': 'application/json' },
      // `contents` first: the endpoint was seen answering 404 to otherwise
      // identical bodies that led with `systemInstruction`.
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: transcript }] }],
        systemInstruction: { parts: [{ text: systemPrompt(context) }] },
        tools: GEMINI_TOOLS,
        // Always a tool: an answer, a question or an action, never free text.
        toolConfig: { functionCallingConfig: { mode: 'ANY' } },
        // A short tool call: as little thinking as the model allows.
        generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
      }),
    },
  );
  if (!response.ok) {
    console.error('gemini error', response.status);
    throw new HttpError(502, 'VOICE_AGENT_FAILED', 'The assistant could not answer just now');
  }
  const result = (await response.json()) as {
    candidates?: { content?: { parts?: { functionCall?: { name?: string; args?: unknown } }[] } }[];
  };
  return (result.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => typeof part.functionCall?.name === 'string')
    .map((part) => ({
      name: part.functionCall?.name as string,
      input: part.functionCall?.args ?? {},
    }));
}
