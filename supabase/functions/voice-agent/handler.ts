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
  CircuitBreaker,
  DeadlineExceeded,
  fetchJsonWithDeadline,
  raceDeadline,
  type DeadlineResponse,
} from '../_shared/resilience.ts';
import { chaosFetch, chaosFor } from '../_shared/voiceChaos.ts';
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
export function llmChain(
  env: (name: string) => string | undefined,
  /** Providers to leave out (an open circuit breaker); the rest move up. */
  skip: (provider: LlmStep['provider']) => boolean = () => false,
): LlmStep[] {
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
  return ordered.filter((step) => !skip(step.provider)).slice(0, 3);
}

/**
 * Time budgets (docs/voice-failure-modes.md). The app gives up on this call
 * after 10 s and reads the sentence on the phone, so the whole request must be
 * answered — success or a refunded 503 — inside 9 s.
 */
export interface Limits {
  /** The whole request, from arrival to response. */
  readonly totalMs: number;
  /** Deepgram pre-recorded (clip mode only). */
  readonly sttMs: number;
  /** One LLM step (a DeepSeek-style 400 retry shares it). */
  readonly llmAttemptMs: number;
  /** One database round trip the request waits on (flag, quota, context). */
  readonly dbMs: number;
  /** Below this much budget left, another LLM step is not started. */
  readonly minAttemptMs: number;
}

export const LIMITS: Limits = {
  totalMs: 9_000,
  sttMs: 8_000,
  llmAttemptMs: 4_000,
  dbMs: 3_000,
  minAttemptMs: 750,
};

/**
 * Per warm instance: after 3 consecutive failures a provider (or Deepgram) is
 * skipped for 60 s, so a provider that is down costs one person a timeout, not
 * every person for as long as the outage lasts.
 */
export const breaker = new CircuitBreaker();

/** A spoken command is a sentence or two; anything longer is not one. */
const MAX_TRANSCRIPT_CHARS = 2000;

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
  /** Overrides for {@link LIMITS} (tests). */
  readonly limits?: Partial<Limits>;
  /** Keep the worker alive for work that outlives the response (a late refund). */
  readonly waitUntil?: (work: Promise<unknown>) => void;
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
  const limits: Limits = { ...LIMITS, ...deps.limits };
  const left = (): number => started + limits.totalMs - deps.now();
  const body = parseBody(await request.json().catch(() => null));

  const { data: userData, error: userError } = await deps.caller.auth.getUser();
  if (userError || !userData?.user) throw new HttpError(401, 'NOT_AUTHENTICATED', 'Sign in first');
  const profileId = userData.user.id as string;

  const unavailable = (message: string) => new HttpError(503, VoiceAgentError.Unavailable, message);

  // Flag first: when the feature is off for this person nothing else about the
  // request should be observable, not even a quota or rate-limit answer.
  const dbDeadline = () => Math.min(limits.dbMs, left());
  const { data: enabled, error: flagError } = await raceDeadline(
    Promise.resolve(deps.service.rpc('waves_voice_agent_enabled', { p_profile: profileId })),
    dbDeadline(),
    () => unavailable('Advanced voice is not available'),
  );
  if (flagError || enabled !== true) throw unavailable('Advanced voice is not available');

  const deepgramKey = deps.env('DEEPGRAM_API_KEY');
  // Text from the app's live stream needs no Deepgram here; a clip does.
  const spoken = body.transcript?.trim() ?? '';
  if ((!spoken && !deepgramKey) || llmChain(deps.env).length === 0) {
    throw unavailable('Advanced voice is not configured');
  }
  // Every configured provider's breaker is open: say so now, before any spend
  // or wait, and the app reads the sentence on the phone at once.
  const chain = llmChain(deps.env, (provider) => breaker.isOpen(provider));
  if (chain.length === 0 || (!spoken && breaker.isOpen('deepgram'))) {
    throw unavailable('Advanced voice is unavailable just now');
  }

  // Failure drills on allowlisted accounts only (VOICE_CHAOS, _shared/voiceChaos.ts).
  const chaos = await chaosFor(deps.env, deps.service, profileId);
  const outbound = chaosFetch(deps.fetch, chaos);

  await deps.rateLimit(profileId);

  if (
    !spoken &&
    ((body.durationMs ?? 0) > VOICE_AGENT_MAX_CLIP_MS ||
      (body.audioBase64?.length ?? 0) * 0.75 > MAX_AUDIO_BYTES)
  ) {
    throw new HttpError(413, VoiceAgentError.ClipTooLong, 'That clip is too long');
  }

  // Quota before any provider spend; refunded if the providers then fail. The
  // caller's groups load alongside it — both are reads the person is waiting
  // on, and a refused quota simply never uses the context.
  const meterOnly = body.meterOnly === true && Boolean(spoken);
  const contextLoad = meterOnly
    ? Promise.resolve(null as unknown as VoiceContext)
    : loadContext(deps.caller, profileId, body);
  contextLoad.catch(() => undefined);
  // At most once per request, whichever failure path gets there first.
  let refunded = false;
  const refund = async (): Promise<void> => {
    if (refunded) return;
    refunded = true;
    await Promise.resolve(
      deps.service.rpc('waves_voice_agent_refund', { p_profile: profileId }),
    ).catch(() => null);
  };
  const reservation = Promise.resolve(
    deps.service.rpc('waves_voice_agent_quota', {
      p_profile: profileId,
      p_free_limit: VOICE_AGENT_FREE_MONTHLY,
      p_pro_limit: VOICE_AGENT_PRO_MONTHLY,
    }),
  );
  let quotaResult: Awaited<typeof reservation>;
  try {
    quotaResult = await raceDeadline(reservation, dbDeadline(), () =>
      unavailable('Advanced voice is not available'),
    );
  } catch (error) {
    // The reservation is a write that may still land after we gave up on it:
    // when it does, give the command back — the person got nothing for it.
    const late = reservation.then(
      (r) => ((r.data as Quota | null)?.allowed ? refund() : null),
      () => null,
    );
    deps.waitUntil?.(late);
    throw error;
  }
  const { data: quotaData, error: quotaError } = quotaResult;
  if (quotaError || !quotaData) throw unavailable('Advanced voice is not available');
  const quota = quotaData as Quota;
  if (!quota.allowed) {
    throw new HttpError(402, VoiceAgentError.QuotaReached, 'Advanced voice allowance used up');
  }
  if (meterOnly) {
    const metered: VoiceAgentResponse = {
      schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
      transcript: spoken,
      actions: [],
      quota: { used: quota.used, limit: quota.limit, tier: quota.tier },
    };
    return json(metered);
  }

  try {
    const context = await raceDeadline(contextLoad, Math.min(limits.dbMs, left()), () =>
      unavailable('Advanced voice is unavailable just now'),
    );
    const transcript =
      spoken ||
      (await transcribe(
        outbound,
        deepgramKey as string,
        body,
        context,
        Math.min(limits.sttMs, left()),
      ));
    if (!transcript) {
      throw new HttpError(422, VoiceAgentError.NothingHeard, 'Nothing was heard');
    }

    // Down the chain until an answer validates against the context. A provider
    // that errors is skipped like one that answered badly; only when every step
    // failed outright does the request fail (and the command is refunded).
    const message = userMessage({
      cloud: transcript,
      followUp: body.followUp,
    });
    // Each step gets at most llmAttemptMs and never more than the request has
    // left; a provider whose breaker opened during this request is skipped.
    let parsed: Parsed | null = null;
    let model = chain[0].model;
    const failures: string[] = [];
    for (const step of chain) {
      const budget = Math.min(limits.llmAttemptMs, left());
      if (budget < limits.minAttemptMs) {
        failures.push('budget');
        break;
      }
      if (breaker.isOpen(step.provider)) continue;
      try {
        const attempt = await ask(outbound, step, context, message, budget);
        breaker.success(step.provider);
        model = step.model;
        parsed = attempt;
        if (attempt.ok) break;
      } catch (error) {
        breaker.failure(step.provider);
        failures.push(
          error instanceof DeadlineExceeded ? `${step.provider}:timeout` : step.provider,
        );
      }
    }
    if (!parsed) {
      console.error(JSON.stringify({ fn: 'voice-agent', event: 'llm_unavailable', failures }));
      throw unavailable('The assistant is unavailable just now');
    }
    const escalated = model !== chain[0].model;
    // No step produced a usable answer: the person is asked to say it again,
    // and that is not a command they should pay for.
    const used = parsed.ok ? quota.used : Math.max(0, quota.used - 1);
    if (!parsed.ok) await refund();

    const response: VoiceAgentResponse = parsed.ok
      ? {
          schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
          transcript,
          actions: parsed.actions,
          ...(parsed.answer ? { answer: parsed.answer } : {}),
          ...(parsed.clarify ? { clarify: parsed.clarify } : {}),
          quota: { used, limit: quota.limit, tier: quota.tier },
        }
      : {
          schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
          transcript,
          actions: [],
          clarify: "Sorry, I didn't catch what to do with that. Could you say it again?",
          quota: { used, limit: quota.limit, tier: quota.tier },
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
        failures,
        ...(chaos.size > 0 ? { chaos: [...chaos] } : {}),
        actions: response.actions.map((a) => a.type),
      }),
    );
    return json(response);
  } catch (error) {
    // The person got nothing for the command: give it back.
    await refund();
    throw error;
  }
}

function parseBody(raw: unknown): VoiceAgentRequest {
  const b = raw as Partial<VoiceAgentRequest> | null;
  const textMode =
    typeof b?.transcript === 'string' &&
    b.transcript.trim().length > 0 &&
    b.transcript.length <= MAX_TRANSCRIPT_CHARS;
  const audioMode =
    typeof b?.audioBase64 === 'string' &&
    b.audioBase64.length > 0 &&
    typeof b.mimeType === 'string' &&
    typeof b.durationMs === 'number' &&
    Number.isFinite(b.durationMs) &&
    b.durationMs > 0;
  if (
    !b ||
    b.schemaVersion !== VOICE_AGENT_SCHEMA_VERSION ||
    !(textMode || audioMode) ||
    typeof b.locale !== 'string' ||
    typeof b.today !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.today) ||
    (b.followUp !== undefined &&
      (typeof b.followUp?.transcript !== 'string' || typeof b.followUp?.question !== 'string'))
  ) {
    throw new HttpError(400, 'BAD_REQUEST', 'Malformed voice request');
  }
  return b as VoiceAgentRequest;
}

/** The caller's groups, members and balances, read as the caller (RLS-scoped). */
/**
 * The caller's groups, members and balances, kept for a short while per warm
 * function instance: a person speaking several commands in a row should not wait
 * on the same three reads each time. Short enough that a member added a moment
 * ago is seen on the next command or the one after.
 */
export const CONTEXT_TTL_MS = 30_000;
const contextCache = new Map<string, { at: number; value: Promise<VoiceContext> }>();

export function loadContext(
  caller: SupabaseClient,
  profileId: string,
  body: VoiceAgentRequest,
  now: number = Date.now(),
): Promise<VoiceContext> {
  const key = `${profileId}|${body.groupId ?? ''}|${body.today}`;
  const hit = contextCache.get(key);
  if (hit && now - hit.at < CONTEXT_TTL_MS) return hit.value;
  const value = loadContextFresh(caller, profileId, body);
  contextCache.set(key, { at: now, value });
  // A failed read is not kept: the next command tries again.
  value.catch(() => contextCache.delete(key));
  if (contextCache.size > 500) {
    for (const [k, v] of contextCache) if (now - v.at >= CONTEXT_TTL_MS) contextCache.delete(k);
  }
  return value;
}

/** Test seam: forget every cached context. */
export function clearContextCache(): void {
  contextCache.clear();
}

async function loadContextFresh(
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
  fetchFn: typeof fetch,
  key: string,
  body: VoiceAgentRequest,
  context: VoiceContext,
  budgetMs: number,
): Promise<string> {
  let audio: Uint8Array;
  try {
    const binary = atob(body.audioBase64 ?? '');
    audio = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Audio is not valid base64');
  }
  const sttDown = () =>
    new HttpError(503, VoiceAgentError.Unavailable, 'Speech recognition is unavailable just now');
  let response: DeadlineResponse;
  try {
    response = await fetchJsonWithDeadline(
      fetchFn,
      deepgramUrl(body.locale, keyterms(context)),
      {
        method: 'POST',
        headers: { Authorization: `Token ${key}`, 'Content-Type': body.mimeType ?? 'audio/wav' },
        body: new Blob([audio]),
      },
      budgetMs,
      'deepgram',
    );
  } catch (error) {
    breaker.failure('deepgram');
    console.error('deepgram error', error instanceof DeadlineExceeded ? 'timeout' : String(error));
    throw sttDown();
  }
  if (!response.ok || response.body === null) {
    breaker.failure('deepgram');
    console.error('deepgram error', response.status);
    throw sttDown();
  }
  breaker.success('deepgram');
  const result = response.body as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  return (result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();
}

/** POST JSON to a provider within what is left of this step's budget. */
type Post = (url: string, init: RequestInit) => Promise<DeadlineResponse>;

async function ask(
  fetchFn: typeof fetch,
  step: LlmStep,
  context: VoiceContext,
  transcript: string,
  budgetMs: number,
): Promise<Parsed> {
  const end = Date.now() + budgetMs;
  const post: Post = (url, init) =>
    fetchJsonWithDeadline(fetchFn, url, init, end - Date.now(), `${step.provider}:${step.model}`);
  const calls =
    step.provider === 'deepseek' || step.provider === 'openrouter'
      ? await askDeepSeek(post, step, context, transcript)
      : step.provider === 'gemini'
        ? await askGemini(post, step, context, transcript)
        : await askAnthropic(post, step, context, transcript);
  return parseToolCalls(calls, context);
}

/** A provider answered with an error status, or with a body that is not JSON. */
function providerFailed(provider: string, response: DeadlineResponse): HttpError {
  console.error(`${provider} error`, response.ok ? 'malformed body' : response.status);
  return new HttpError(502, 'VOICE_AGENT_FAILED', 'The assistant could not answer just now');
}

async function askAnthropic(
  post: Post,
  step: LlmStep,
  context: VoiceContext,
  transcript: string,
): Promise<ToolCall[]> {
  const response = await post('https://api.anthropic.com/v1/messages', {
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
  if (!response.ok || response.body === null) throw providerFailed('anthropic', response);
  const message = response.body as {
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
  post: Post,
  step: LlmStep,
  context: VoiceContext,
  transcript: string,
): Promise<ToolCall[]> {
  const request = (lowEffort: boolean) =>
    post(
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
          // OpenRouter: only route to providers that neither store nor train on
          // the prompt — it carries people's names and money. What the consent
          // sheet tells them depends on this.
          ...(step.provider === 'openrouter' ? { provider: { data_collection: 'deny' } } : {}),
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
  if (!response.ok || response.body === null) throw providerFailed(step.provider, response);
  const completion = response.body as {
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
  post: Post,
  step: LlmStep,
  context: VoiceContext,
  transcript: string,
): Promise<ToolCall[]> {
  const response = await post(
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
  if (!response.ok || response.body === null) throw providerFailed('gemini', response);
  const result = response.body as {
    candidates?: { content?: { parts?: { functionCall?: { name?: string; args?: unknown } }[] } }[];
  };
  return (result.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => typeof part.functionCall?.name === 'string')
    .map((part) => ({
      name: part.functionCall?.name as string,
      input: part.functionCall?.args ?? {},
    }));
}
