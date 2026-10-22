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
  VOICE_AGENT_TRIAL_COMMANDS,
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
import { clipDurationSeconds } from '../_shared/audioDuration.ts';
import { chaosFetch, chaosFor } from '../_shared/voiceChaos.ts';
import { withVoiceStub } from '../_shared/voiceStub.ts';
import {
  ANTHROPIC_TOOLS,
  anthropicCostUsd,
  anthropicSystem,
  buildContext,
  deepgramUrl,
  keyterms,
  parseToolCalls,
  systemPrompt,
  TOOLS,
  userMessage,
  type AnthropicUsage,
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

/**
 * Audio ceiling for a clip. 60 s of 16 kHz mono PCM is 1.9 MB; AAC / Opus at any
 * sane bitrate is far less. The client's `durationMs` is a hint only: the length
 * Deepgram measures is what is enforced ({@link MAX_CLIP_SECONDS}).
 */
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
/** The measured length a clip may have; a second over the declared cap for codec padding. */
export const MAX_CLIP_SECONDS = VOICE_AGENT_MAX_CLIP_MS / 1000 + 1;

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
  tier: 'free' | 'pro';
  /** On the Pro trial: `limit` is the trial's total, not a month's. */
  trial?: boolean;
  /** With `trial`: when the pool closes. */
  until?: string;
  allowed: boolean;
  /** For a refused follow-up: free_tier, no_slot, expense_cap or month_cap. */
  reason?: string;
  /** The UTC month ('YYYY-MM') the reservation was taken in: what a refund names. */
  month?: string;
}

export async function handleVoiceAgent(request: Request, realDeps: Deps): Promise<Response> {
  // Staging-only canned model for the E2E flows; refused on production
  // (_shared/voiceStub.ts). A no-op unless VOICE_AGENT_STUB=1.
  const stubbed = withVoiceStub(realDeps.env, realDeps.fetch);
  const deps: Deps = stubbed.active
    ? { ...realDeps, env: stubbed.env, fetch: stubbed.fetch }
    : realDeps;
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
  // A follow-up about an expense just saved (a correction, an undo, a place) is
  // not a new command, so it is outside the monthly allowance (D1). It is not
  // free: the database admits it only for a paid plan (or the Pro trial) and
  // caps it per month and per expense, so it is never refunded either.
  const unmetered = body.savedExpense !== undefined && !meterOnly;
  const contextLoad = meterOnly
    ? Promise.resolve(null as unknown as VoiceContext)
    : loadContext(deps.caller, profileId, body);
  contextLoad.catch(() => undefined);
  if (unmetered && body.savedExpense) {
    const groups = (
      await raceDeadline(contextLoad, dbDeadline(), () =>
        unavailable('Advanced voice is unavailable just now'),
      )
    ).groups;
    await verifySavedExpense(deps.caller, body.savedExpense, groups, dbDeadline(), unavailable);
  }
  // At most once per request, whichever failure path gets there first. An
  // unmetered follow-up never took a command, so it has nothing to give back.
  // And only while nothing has been sent to a provider: once Deepgram or a
  // model has been asked, the cost is real whatever came back, so the command
  // stays spent (a refund after that point would be a free retry loop).
  let refunded = unmetered;
  let spent = false;
  let bucket: { month?: string; trial?: boolean } = {};
  const refundBucket = (q: Quota | null): Record<string, unknown> => ({
    p_profile: profileId,
    p_month: q?.month ?? null,
    p_trial: q?.trial ?? false,
  });
  const refund = async (): Promise<void> => {
    if (refunded || spent) return;
    refunded = true;
    await Promise.resolve(
      deps.service.rpc('waves_voice_agent_refund', refundBucket(bucket as Quota)),
    ).catch(() => null);
  };
  const reservation = unmetered
    ? Promise.resolve(
        deps.service.rpc('waves_voice_agent_followup', {
          p_profile: profileId,
          p_expense_id: body.savedExpense?.id,
          p_month_limit: FOLLOWUP_PER_MONTH,
          p_expense_limit: FOLLOWUP_PER_EXPENSE,
          p_window_seconds: FOLLOWUP_WINDOW_SECONDS,
        }),
      )
    : Promise.resolve(
        deps.service.rpc('waves_voice_agent_quota', {
          p_profile: profileId,
          p_free_limit: VOICE_AGENT_FREE_MONTHLY,
          p_pro_limit: VOICE_AGENT_PRO_MONTHLY,
          p_trial_limit: VOICE_AGENT_TRIAL_COMMANDS,
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
      (r) => {
        const q = r.data as Quota | null;
        if (!q?.allowed || unmetered) return null;
        return Promise.resolve(deps.service.rpc('waves_voice_agent_refund', refundBucket(q))).catch(
          () => null,
        );
      },
      () => null,
    );
    deps.waitUntil?.(late);
    throw error;
  }
  const { data: quotaData, error: quotaError } = quotaResult;
  if (quotaError || !quotaData) throw unavailable('Advanced voice is not available');
  const quota = quotaData as Quota;
  bucket = { month: quota.month, trial: quota.trial };
  if (!quota.allowed) {
    if (unmetered) {
      if (quota.reason === 'free_tier') {
        throw new HttpError(403, 'VOICE_AGENT_FOLLOWUP_PRO', 'Follow-ups are part of Pro');
      }
      throw new HttpError(429, 'VOICE_AGENT_FOLLOWUP_CAP', 'Too many follow-ups just now');
    }
    throw new HttpError(402, VoiceAgentError.QuotaReached, 'Advanced voice allowance used up');
  }
  // Cloud transcription of a clip is for Pro and the trial, like the live
  // stream (waves_voice_stream_mint): Free sends the phone's own transcript.
  // Decided here from the database's answer, before any byte reaches Deepgram;
  // the command just reserved is given back.
  if (!spoken && !unmetered && quota.tier === 'free' && !quota.trial) {
    await refund();
    throw new HttpError(
      403,
      VoiceAgentError.StreamFreeTier,
      'Cloud transcription is not on this plan',
    );
  }
  if (meterOnly) {
    // A command the phone parsed itself and is about to save: the follow-up
    // turns about it need a slot, exactly as a cloud-parsed command's do. The
    // budget is the same (one charged command, a few turns), and a money
    // question metered this way has no saved expense to follow up on.
    const open = Promise.resolve(
      deps.service.rpc('waves_voice_agent_followup_open', {
        p_profile: profileId,
        p_turns: FOLLOWUP_PER_EXPENSE,
        p_window_seconds: FOLLOWUP_WINDOW_SECONDS,
      }),
    ).catch(() => null);
    if (deps.waitUntil) deps.waitUntil(open);
    else await open;
    const metered: VoiceAgentResponse = {
      schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
      transcript: spoken,
      actions: [],
      quota: {
        used: quota.used,
        limit: quota.limit,
        tier: quota.tier,
        trial: quota.trial,
        until: quota.until,
      },
    };
    return json(metered);
  }

  try {
    const loaded = await raceDeadline(contextLoad, Math.min(limits.dbMs, left()), () =>
      unavailable('Advanced voice is unavailable just now'),
    );
    // A follow-up turn is read against the expense just saved (never cached:
    // the cached context is shared across requests).
    const context: VoiceContext = body.savedExpense
      ? followUpContext(loaded, body.savedExpense)
      : loaded;
    let transcript = spoken;
    if (!transcript) {
      // The clip is checked locally first (base64, size, container, length):
      // a refusal there costs nothing. The command is spent the moment the
      // request to Deepgram goes out (`onSend`).
      const heard = await transcribe(
        outbound,
        deepgramKey as string,
        body,
        context,
        Math.min(limits.sttMs, left()),
        () => {
          spent = true;
        },
      );
      // The length Deepgram measured, not the one the client declared. A clip
      // over the cap gets nothing back: no transcript, no refund.
      if (heard.seconds !== null && heard.seconds > MAX_CLIP_SECONDS) {
        throw new HttpError(413, VoiceAgentError.ClipTooLong, 'That clip is too long');
      }
      transcript = heard.transcript;
    }
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
    // Anthropic token counts summed over the steps that answered, with cache
    // reads and writes kept apart: they are priced differently.
    const spend = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, steps: 0 };
    const onUsage = (stepModel: string, usage: AnthropicUsage): void => {
      spend.steps += 1;
      spend.input += usage.input_tokens ?? 0;
      spend.output += usage.output_tokens ?? 0;
      spend.cacheRead += usage.cache_read_input_tokens ?? 0;
      spend.cacheWrite += usage.cache_creation_input_tokens ?? 0;
      spend.costUsd += anthropicCostUsd(stepModel, usage) ?? 0;
    };
    for (const step of chain) {
      const budget = Math.min(limits.llmAttemptMs, left());
      if (budget < limits.minAttemptMs) {
        failures.push('budget');
        break;
      }
      if (breaker.isOpen(step.provider)) continue;
      try {
        const attempt = await ask(outbound, step, context, message, budget, onUsage, () => {
          spent = true;
        });
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
    // No step produced a usable answer: the person is asked to say it again.
    // The models were asked all the same, so the command stays spent (a bad
    // answer a client can provoke on purpose must not be a free retry).
    let charged: Quota = quota;
    if (parsed.ok && unmetered && parsed.answer && !parsed.update && !parsed.delete) {
      // A follow-up that is really a question ("who owes me?") is a command,
      // not a correction: it counts against the allowance like any other.
      // Refused when the allowance is spent, and the answer is withheld.
      const { data, error } = await raceDeadline(
        Promise.resolve(
          deps.service.rpc('waves_voice_agent_quota', {
            p_profile: profileId,
            p_free_limit: VOICE_AGENT_FREE_MONTHLY,
            p_pro_limit: VOICE_AGENT_PRO_MONTHLY,
            p_trial_limit: VOICE_AGENT_TRIAL_COMMANDS,
          }),
        ),
        dbDeadline(),
        () => unavailable('Advanced voice is not available'),
      );
      const asked = data as Quota | null;
      if (error || !asked) throw unavailable('Advanced voice is not available');
      if (!asked.allowed) {
        throw new HttpError(402, VoiceAgentError.QuotaReached, 'Advanced voice allowance used up');
      }
      charged = asked;
    }
    const used = charged.used;
    // A metered command that produced something the app will save opens the
    // door to a few follow-up turns about it ("make it 800", "undo"). The slot
    // is what waves_voice_agent_followup admits a follow-up against; a
    // follow-up with no slot behind it is refused there.
    if (parsed.ok && !unmetered && parsed.actions.length > 0) {
      const open = Promise.resolve(
        deps.service.rpc('waves_voice_agent_followup_open', {
          p_profile: profileId,
          p_turns: FOLLOWUP_PER_EXPENSE,
          p_window_seconds: FOLLOWUP_WINDOW_SECONDS,
        }),
      ).catch(() => null);
      if (deps.waitUntil) deps.waitUntil(open);
      else await open;
    }

    const response: VoiceAgentResponse = parsed.ok
      ? {
          schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
          transcript,
          actions: parsed.actions,
          ...(parsed.answer ? { answer: parsed.answer } : {}),
          ...(parsed.update ? { update: parsed.update } : {}),
          ...(parsed.delete ? { delete: parsed.delete } : {}),
          ...(parsed.clarify ? { clarify: parsed.clarify } : {}),
          ...(parsed.clarify && parsed.clarifyOptions
            ? { clarifyOptions: parsed.clarifyOptions }
            : {}),
          quota: {
            used,
            limit: charged.limit,
            tier: charged.tier,
            trial: charged.trial,
            until: charged.until,
          },
        }
      : {
          schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
          transcript,
          actions: [],
          clarify: "Sorry, I didn't catch what to do with that. Could you say it again?",
          quota: {
            used,
            limit: quota.limit,
            tier: quota.tier,
            trial: quota.trial,
            until: quota.until,
          },
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
        ...(spend.steps > 0
          ? {
              anthropic: {
                inputTokens: spend.input,
                outputTokens: spend.output,
                cacheReadTokens: spend.cacheRead,
                cacheWriteTokens: spend.cacheWrite,
                costUsd: Number(spend.costUsd.toFixed(6)),
              },
            }
          : {}),
        ...(chaos.size > 0 ? { chaos: [...chaos] } : {}),
        actions: response.actions.map((a) => a.type),
        ...(response.update
          ? { updateFields: Object.keys(response.update).filter((key) => key !== 'expenseId') }
          : {}),
        ...(response.delete ? { deleted: true } : {}),
      }),
    );
    return json(response);
  } catch (error) {
    // The person got nothing for the command: give it back — unless a
    // provider was already asked (see `spent`).
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
    // A turn answers either the agent's question or a saved expense, never both.
    (b.followUp !== undefined && b.savedExpense !== undefined) ||
    (b.followUp !== undefined &&
      (typeof b.followUp?.transcript !== 'string' || typeof b.followUp?.question !== 'string')) ||
    (b.savedExpense !== undefined &&
      (typeof b.savedExpense?.id !== 'string' ||
        b.savedExpense.id.length === 0 ||
        b.savedExpense.id.length > 64 ||
        (b.savedExpense.kind !== 'personal' && b.savedExpense.kind !== 'group') ||
        (b.savedExpense.question !== undefined && typeof b.savedExpense.question !== 'string')))
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

/** Follow-up caps, enforced in the database (`waves_voice_agent_followup`). */
export const FOLLOWUP_PER_EXPENSE = 3;
export const FOLLOWUP_WINDOW_SECONDS = 10 * 60;
export const FOLLOWUP_PER_MONTH = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A group expense the turn is about must be one the caller can see: a real,
 * live expense in a group they belong to (read as the caller, so row-level
 * security decides). A personal record lives in an encrypted blob the server
 * cannot read, so for those the database cap is the guard.
 */
async function verifySavedExpense(
  caller: SupabaseClient,
  saved: NonNullable<VoiceAgentRequest['savedExpense']>,
  callerGroups: readonly { readonly id: string }[],
  deadlineMs: number,
  unavailable: (message: string) => HttpError,
): Promise<void> {
  if (saved.kind !== 'group') return;
  const refuse = () => new HttpError(403, 'BAD_SAVED_EXPENSE', 'That expense is not one of yours');
  // The group must be one of the caller's own, and the id must be an id.
  if (!callerGroups.some((g) => g.id === saved.groupId) || !UUID.test(saved.id)) throw refuse();
  const { data, error } = await raceDeadline(
    Promise.resolve(
      caller
        .from('expenses')
        .select('id')
        .eq('id', saved.id)
        .eq('group_id', saved.groupId)
        .is('deleted_at', null)
        .limit(1),
    ),
    deadlineMs,
    () => unavailable('Advanced voice is unavailable just now'),
  );
  if (error) throw unavailable('Advanced voice is unavailable just now');
  if (!Array.isArray(data) || data.length === 0) throw refuse();
}

/**
 * What a follow-up turn is told about: for a group expense only that group, so
 * the model cannot be talked into naming a group or person the turn is not
 * about; for a personal one all of the caller's groups (it may be shared).
 */
function followUpContext(
  loaded: VoiceContext,
  saved: NonNullable<VoiceAgentRequest['savedExpense']>,
): VoiceContext {
  const groups =
    saved.kind === 'group' ? loaded.groups.filter((g) => g.id === saved.groupId) : loaded.groups;
  return { ...loaded, groups, saved };
}

async function loadContextFresh(
  caller: SupabaseClient,
  profileId: string,
  body: VoiceAgentRequest,
): Promise<VoiceContext> {
  const { data: groups, error: groupsError } = await caller
    .from('groups')
    .select('id, name, type, default_currency, units')
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

/** What Deepgram heard, and how long the clip really was (null when it did not say). */
interface Heard {
  transcript: string;
  seconds: number | null;
}

async function transcribe(
  fetchFn: typeof fetch,
  key: string,
  body: VoiceAgentRequest,
  context: VoiceContext,
  budgetMs: number,
  onSend: () => void = () => undefined,
): Promise<Heard> {
  let audio: Uint8Array;
  try {
    const binary = atob(body.audioBase64 ?? '');
    audio = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Audio is not valid base64');
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new HttpError(413, VoiceAgentError.ClipTooLong, 'That clip is too long');
  }
  // The container says how long the clip is, before a byte leaves this server
  // (_shared/audioDuration.ts). A type that cannot be measured, or bytes that
  // do not parse as the type they claim, are refused: Deepgram bills what it
  // decodes, and nothing is sent that this server could not bound.
  const measured = clipDurationSeconds(audio, body.mimeType ?? '');
  if (measured === null) {
    throw new HttpError(415, VoiceAgentError.ClipUnreadable, 'That audio format is not accepted');
  }
  if (measured > MAX_CLIP_SECONDS) {
    throw new HttpError(413, VoiceAgentError.ClipTooLong, 'That clip is too long');
  }
  const sttDown = () =>
    new HttpError(503, VoiceAgentError.Unavailable, 'Speech recognition is unavailable just now');
  let response: DeadlineResponse;
  try {
    onSend();
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
    metadata?: { duration?: number };
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  const duration = result.metadata?.duration;
  return {
    transcript: (result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim(),
    seconds:
      typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
        ? duration
        : measured,
  };
}

export { clipDurationSeconds, wavDurationSeconds } from '../_shared/audioDuration.ts';

/** POST JSON to a provider within what is left of this step's budget. */
type Post = (url: string, init: RequestInit) => Promise<DeadlineResponse>;

async function ask(
  fetchFn: typeof fetch,
  step: LlmStep,
  context: VoiceContext,
  transcript: string,
  budgetMs: number,
  onUsage: (model: string, usage: AnthropicUsage) => void = () => undefined,
  onSend: () => void = () => undefined,
): Promise<Parsed> {
  const end = Date.now() + budgetMs;
  const post: Post = (url, init) => {
    onSend();
    return fetchJsonWithDeadline(
      fetchFn,
      url,
      init,
      end - Date.now(),
      `${step.provider}:${step.model}`,
    );
  };
  const calls =
    step.provider === 'deepseek' || step.provider === 'openrouter'
      ? await askDeepSeek(post, step, context, transcript)
      : step.provider === 'gemini'
        ? await askGemini(post, step, context, transcript)
        : await askAnthropic(post, step, context, transcript, onUsage);
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
  onUsage: (model: string, usage: AnthropicUsage) => void = () => undefined,
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
      // Prompt caching is prefix-based (tools, then system, then messages):
      // the last tool and the static instructions each carry a breakpoint, and
      // the per-request context follows in its own uncached block.
      system: anthropicSystem(context),
      tools: ANTHROPIC_TOOLS,
      // Always a tool: an answer, a question or an action, never free text.
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: transcript }],
    }),
  });
  if (!response.ok || response.body === null) throw providerFailed('anthropic', response);
  const message = response.body as {
    content?: { type: string; name?: string; input?: unknown }[];
    usage?: AnthropicUsage;
  };
  if (message.usage) onUsage(step.model, message.usage);
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
