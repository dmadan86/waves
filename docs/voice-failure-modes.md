# Advanced voice: failure modes

What the Pro advanced-voice pipeline does when a dependency fails, and where
that is handled. The rules every row must keep:

- **Never hang.** Every outbound call has a budget; nothing waits on the network
  without a timer.
- **Never stuck on "Listening…" or "Understanding…".** Every capture ends at a
  timer, and every agent call answers within 10 s.
- **Never charge a command for a failed request.** A reserved command is
  refunded on every failure path, including an "ask again" answer.
- **Always fall back to the on-device basic voice**, using the transcript already
  heard when there is one, and say why on the engine badge: _Monthly limit
  reached_, _Offline_ (only when the phone itself says so) or _Cloud
  unavailable_ (online, but the relay, Deepgram, the agent or its models failed
  or timed out).

## The pipeline

```
mic ─(PCM)→ voice-stream relay ─(WS)→ Deepgram live
                 │ Ready / results / close codes
app ─(transcript)→ voice-agent ─→ OpenRouter (Gemini 3.5 Flash-Lite, 3.1 Flash-Lite) → Gemini direct
                       │  quota reserve / refund (waves_voice_agent_quota / _refund)
                       └─ Deepgram pre-recorded (clip mode only)
```

Fast path: when the on-device parser is fully confident in the streamed
sentence, the agent is skipped and the command is metered with a
fire-and-forget `meterOnly` call. Nothing on the fast path waits on the agent,
so none of the agent timeouts below can slow it.

## Budgets

| Where                    | Call                                  | Budget                            | On expiry                                           |
| ------------------------ | ------------------------------------- | --------------------------------- | --------------------------------------------------- |
| voice-agent              | whole request                         | 9 s                               | refunded 503 `VOICE_AGENT_UNAVAILABLE`              |
| voice-agent              | Deepgram pre-recorded (clip)          | min(8 s, budget left)             | aborted, refunded 503                               |
| voice-agent              | each LLM step (AbortController)       | min(4 s, budget left)             | aborted, next step; none left → refunded 503        |
| voice-agent              | new LLM step                          | needs ≥ 0.75 s left               | not started; refunded 503 if nothing answered       |
| voice-agent              | flag RPC, quota RPC, context read     | min(3 s, budget left) each        | 503; a late quota reservation is refunded           |
| voice-stream relay       | Deepgram upstream connect             | 4 s                               | client closed with 4503                             |
| voice-stream relay       | caller names (keyterms) read          | 1.5 s                             | stream opens without keyterms                       |
| voice-stream relay       | flush after CloseStream               | 1.5 s                             | closed                                              |
| voice-stream relay       | session                               | 20 s audio / 25 s wall / 5 s idle | flushed and closed                                  |
| app (`voiceStream.ts`)   | relay WebSocket open                  | 4 s                               | on-device recogniser, badge _Cloud unavailable_     |
| app (`voiceStream.ts`)   | relay Ready (gate + its 4 s upstream) | 6 s                               | on-device recogniser, badge _Cloud unavailable_     |
| app (`voiceStream.ts`)   | flush on stop                         | 1.5 s                             | whatever was transcribed is used                    |
| app (`VoiceCapture.tsx`) | first word / silence / session        | 5 s / 2.2 s / 20 s                | the capture ends                                    |
| app (`voiceAgent.ts`)    | agent call                            | 10 s                              | basic parser on the transcript, _Cloud unavailable_ |
| app (`voiceAgent.ts`)    | fast-path meter call                  | 10 s                              | ignored (fire-and-forget)                           |

## Circuit breaker

`_shared/resilience.ts`, one instance per warm function instance (module state):
after **3 consecutive failures** a key is skipped for **60 s**; the first call after
the cooldown is a trial (one more failure re-opens it, a success closes it).

- **voice-agent** keys: `openrouter`, `gemini`, `deepseek`, `anthropic` (all models of
  a provider share one key) and `deepgram` (clip mode). A skipped provider's
  steps drop out of the chain and the next provider moves up (so with OpenRouter
  open, Gemini gets both its models). With every configured provider open, or
  Deepgram open for a clip, the request fails fast with 503 **before** the
  command is reserved and before any fetch.
- **voice-stream** key: `deepgram-live`. While open the relay refuses at once
  (4503) **before** the gate mints a stream, so the app falls back in one round
  trip instead of waiting out a 4 s connect.
- A failure is a timeout, a refused connection, any non-2xx answer, or a 2xx
  body that is not JSON. A well-formed answer the validator rejects ("garbage")
  is a model-quality problem, not an outage, and does not count.

## The matrix

"Before" is the state on `feat/voice-stream-relay`; "Now" is after this change.

### Deepgram

| Failure                                            | Before                                                                                             | Now                                                                              | Where                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Down (live): upstream refused / closes before open | Handled: relay refuses 4503, app falls back on-device — but the badge said _Offline_               | Same, badge _Cloud unavailable_; counts toward the `deepgram-live` breaker       | `voice-stream/handler.ts`, `voiceEnginePure.resolveEngine`      |
| Slow (live): upstream never opens                  | Handled: 4 s upstream timer → 4503                                                                 | Same; counts toward the breaker                                                  | `voice-stream/handler.ts` `UPSTREAM_OPEN_MS`                    |
| 401 (live): bad key                                | Handled as "down" (Deepgram closes the upgrade)                                                    | Same, and three in a row open the breaker so later streams are refused instantly | `voice-stream/handler.ts`                                       |
| Mid-stream drop                                    | Handled: relay closes 1011, app keeps the words heard and sends them on (or shows "couldn't hear") | Unchanged; drillable with `relay-drop`                                           | `voice-stream/handler.ts`, `voiceStream.ts`, `VoiceCapture.tsx` |
| Down / 401 (clip, pre-recorded)                    | 502, refunded                                                                                      | 503 `VOICE_AGENT_UNAVAILABLE`, refunded; breaker `deepgram`                      | `voice-agent/handler.ts` `transcribe`                           |
| Slow (clip)                                        | **No timeout**: waited until the platform killed the function                                      | **Fixed**: aborted at min(8 s, budget left), refunded 503                        | `voice-agent/handler.ts` `transcribe`                           |

### OpenRouter / Gemini (the LLM chain)

| Failure                   | Before                                                                        | Now                                                                                          | Where                                    |
| ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Down (connection refused) | Next step; the last one's error became a 502 or 500, refunded                 | Next step; none left → 503 `VOICE_AGENT_UNAVAILABLE`, refunded; breaker                      | `voice-agent/handler.ts` chain loop      |
| 5xx                       | Next step; last → 502, refunded                                               | Next step; none left → refunded 503; breaker                                                 | same                                     |
| 429                       | Next step (treated as an error)                                               | Same, and counts toward the breaker                                                          | same                                     |
| Slow / timeout            | **No timeout**: the app sat on "Understanding…" until the function was killed | **Fixed**: each step aborted at min(4 s, budget left); 9 s total; refunded 503               | `ask`, `fetchJsonWithDeadline`           |
| Body not JSON             | `response.json()` threw a SyntaxError → next step; last → 500 `INTERNAL`      | **Fixed**: counted as a provider failure → next step / refunded 503                          | `fetchJsonWithDeadline` (body `null`)    |
| Malformed tool output     | Next step; all invalid → an "ask again" answer, **charged**                   | **Fixed**: same "ask again", but the command is refunded (`quota.used` reflects it)          | `voice-agent/handler.ts`                 |
| Provider down for a while | Every request paid each provider's failure in turn                            | **Fixed**: breaker skips it for 60 s after 3 failures; all open → fail fast before reserving | `_shared/resilience.ts` `CircuitBreaker` |

### Supabase

| Failure                                        | Before                                                                             | Now                                                                                     | Where                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Edge function cold                             | No client socket-open timer (only the 6 s Ready timer); agent call unbounded       | **Fixed**: socket open 4 s, agent call 10 s; both fall back on-device                   | `voiceStream.ts`, `voiceAgent.ts`                  |
| Edge function 5xx / unreachable                | Agent: fallback, badge only said _Offline_ if actually offline (else kept "Cloud") | Fallback; badge _Cloud unavailable_ (or _Offline_)                                      | `VoiceAgentPanel.tsx`, `voice.tsx` `agentFellBack` |
| Edge function slow                             | Unbounded                                                                          | **Fixed**: 9 s server budget, 10 s app budget                                           | as above                                           |
| Quota RPC errors                               | Handled: 503 before any spend, nothing to refund                                   | Unchanged                                                                               | `voice-agent/handler.ts`                           |
| Quota RPC slow                                 | Unbounded                                                                          | **Fixed**: 503 after 3 s; if the reservation lands later it is refunded (`waitUntil`)   | `voice-agent/handler.ts`                           |
| Flag RPC slow                                  | Unbounded                                                                          | **Fixed**: 503 after 3 s, nothing reserved                                              | `voice-agent/handler.ts`                           |
| Context (groups/members) read fails or is slow | Fails: 500, refunded. Slow: unbounded                                              | Fails: unchanged (500, refunded → app falls back). Slow: **fixed**, refunded 503 at 3 s | `voice-agent/handler.ts`                           |
| Context read slow in the relay                 | Held the Deepgram connect                                                          | **Fixed**: after 1.5 s the stream opens without keyterms                                | `voice-stream/handler.ts` `CONTEXT_WAIT_MS`        |
| Stream-seconds meter RPC fails                 | Logged, stream unaffected                                                          | Unchanged                                                                               | `voice-stream/handler.ts` `settle`                 |

### The phone and the relay

| Failure                         | Before                                                                                  | Now                                                                                                       | Where                                     |
| ------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Offline before the press        | Handled: on-device, badge _Offline_                                                     | Unchanged                                                                                                 | `planMicStart`                            |
| Offline mid-stream              | Handled: the silence / first-word / 20 s timers end the capture; flush capped at 1.5 s  | Unchanged; the agent call that follows now times out at 10 s (or fails at once) → basic parser, _Offline_ | `VoiceCapture.tsx`, `voiceAgent.ts`       |
| Relay closes before Ready       | Handled: 4402 → quota, anything else → on-device; badge said _Offline_ even when online | Badge _Cloud unavailable_ unless the phone is offline                                                     | `relayCloseFailure`, `resolveEngine`      |
| Relay closes after Ready        | Handled: words kept and sent on; nothing heard → "couldn't hear" error, mic released    | Unchanged                                                                                                 | `voiceStream.ts` `onclose`                |
| Relay never answers the upgrade | Waited for the 6 s Ready timer                                                          | **Fixed**: 4 s socket-open timer                                                                          | `voiceStream.ts` `SOCKET_OPEN_TIMEOUT_MS` |

### Response codes the app sees

| Server answer                                   | App result    | Badge after fallback               |
| ----------------------------------------------- | ------------- | ---------------------------------- |
| 402 `VOICE_AGENT_QUOTA` / `VOICE_STREAM_BUDGET` | `quota`       | _Monthly limit reached_            |
| 503 `VOICE_AGENT_UNAVAILABLE`                   | `unavailable` | _Cloud unavailable_ (or _Offline_) |
| no answer in 10 s                               | `timeout`     | _Cloud unavailable_ (or _Offline_) |
| 5xx, 429, network error, malformed body         | `error`       | _Cloud unavailable_ (or _Offline_) |
| relay close 4402                                | `quota`       | _Monthly limit reached_            |
| relay close 4401/4429/4503/1006/timeout         | `error`       | _Cloud unavailable_ (or _Offline_) |

## Chaos drills (production-safe)

Faults can be injected into the live functions for **allowlisted accounts only**
(`voice_agent_allowlist`). Two secrets are required; with either unset the
functions take the exact normal path and do not even read the allowlist.

| Flag            | voice-agent                                                                        | voice-stream relay                                 |
| --------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `deepgram-down` | Deepgram pre-recorded answers 503 (clip mode)                                      | upstream refused → 4503 → on-device                |
| `deepgram-slow` | Deepgram pre-recorded hangs until its 8 s deadline                                 | upstream never opens → 4503 after 4 s → on-device  |
| `llm-down`      | every LLM provider answers 503 → refunded 503 → basic parser                       | —                                                  |
| `llm-slow`      | every LLM provider hangs until its 4 s deadline → 503 by ~9 s                      | —                                                  |
| `llm-garbage`   | every LLM answers a tool call to a tool that does not exist → refunded "ask again" | —                                                  |
| `relay-drop`    | —                                                                                  | the stream is cut with 1011 one second after Ready |

Faults are injected at the network edge (a fetch wrapper and a relay hook), so
the real deadlines, breaker, refunds and fallbacks are what run. Injected
failures do count toward the breaker on that instance, so `llm-down` will open
the providers' breakers for 60 s for **everyone** served by that warm instance —
run drills off-peak, or expect a minute of fast 503s (which the app handles as
_Cloud unavailable_) after a drill.

Turn it on (one or more flags, comma-separated):

```sh
npx supabase secrets set --project-ref <ref> VOICE_CHAOS_ENABLED=1 VOICE_CHAOS=llm-slow
npx supabase secrets set --project-ref <ref> VOICE_CHAOS=deepgram-down,relay-drop   # change the drill
```

Make sure the test account is on the allowlist:

```sql
insert into public.voice_agent_allowlist (profile_id, note)
values ('<profile uuid>', 'chaos drills') on conflict do nothing;
```

Turn it off (either secret alone is enough; unset both):

```sh
npx supabase secrets unset --project-ref <ref> VOICE_CHAOS_ENABLED VOICE_CHAOS
```

Secrets reach new function instances within a few seconds; no deploy is needed.
Each drilled request logs `{"event":"voice_chaos","flags":[…]}` and the
voice-agent summary line carries `chaos` and `failures`, so a drill is easy to
find in the function logs and never mistaken for a real outage.

What to check on the phone during a drill:

- `deepgram-down` / `deepgram-slow`: the mic still listens (on-device) within
  1 s / 4 s, badge _On-device · Cloud unavailable_.
- `llm-down` / `llm-slow`: the spoken sentence lands in the ordinary review
  (basic parser) within 1 s / 9 s, badge _Cloud unavailable_; the month's count
  does not go up.
- `llm-garbage`: "Sorry, I didn't catch what to do with that"; the count does
  not go up.
- `relay-drop`: the words heard in the first second are kept and go on; nothing
  heard → "couldn't hear", the mic is free again.

## Tests

- `supabase/functions/voice-agent/failure.test.ts`: one test per server row
  (Deepgram down/401/slow, LLM down/429/slow/timeout/non-JSON/garbage, quota RPC
  error/slow with late refund, context failure, breaker skip and fail-fast,
  chaos flags and their gating).
- `supabase/functions/voice-stream/handler.test.ts` ("failure modes"): upstream
  refused, slow context, breaker open/close, chaos `deepgram-down`,
  `deepgram-slow`, `relay-drop`, and gating.
- `supabase/functions/_shared/resilience.test.ts`: deadlines, the breaker, chaos
  parsing and the fetch wrapper.
- `apps/mobile/test/voiceDegrade.test.ts`: the failure → badge mapping, the 10 s
  agent timeout (with abort), the 4 s socket-open timeout, and that an opened
  socket keeps the full Ready budget.
