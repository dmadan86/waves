/**
 * WAV-12 / M1, the edge half: a follow-up turn with a client-chosen personal
 * expense id was admitted on the id alone, and `answer_question` in a
 * follow-up was a full LLM answer outside the command allowance.
 *
 * Now a metered command that produced an action opens a follow-up slot
 * (waves_voice_agent_followup_open), the database refuses a turn with no slot
 * ('no_slot' -> 429), and a follow-up that only answers a question is charged
 * a command (402, and no answer, when the allowance is spent).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  breaker,
  clearContextCache,
  FOLLOWUP_PER_EXPENSE,
  FOLLOWUP_WINDOW_SECONDS,
  handleVoiceAgent,
} from '../../voice-agent/handler.ts';
import { fixtures } from '../../voice-agent/evals/harness.ts';
import { goodExpense, makeDeps, ME, openrouter, textRequest } from './voiceDeps.ts';

beforeEach(() => {
  breaker.reset();
  clearContextCache();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const saved = fixtures.saved.personal;
const names = (rpc: ReturnType<typeof makeDeps>['rpc']) => rpc.mock.calls.map(([n]) => n);

describe('WAV-12 the slot', () => {
  it('a metered command that produced an action opens a follow-up slot with the caps', async () => {
    const { deps, rpc } = makeDeps({
      fetchImpl: () => openrouter([{ name: 'add_expense', input: goodExpense }]),
    });
    const body = await (await handleVoiceAgent(textRequest(), deps)).json();
    expect(body.actions).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('waves_voice_agent_followup_open', {
      p_profile: ME,
      p_turns: FOLLOWUP_PER_EXPENSE,
      p_window_seconds: FOLLOWUP_WINDOW_SECONDS,
    });
  });

  it('a metered command that produced nothing to save opens no slot', async () => {
    const { deps, rpc } = makeDeps({
      fetchImpl: () => openrouter([{ name: 'answer_question', input: { text: 'Nothing owed.' } }]),
    });
    await handleVoiceAgent(textRequest(), deps);
    expect(names(rpc)).not.toContain('waves_voice_agent_followup_open');
  });

  it('a follow-up the database refuses for want of a slot is 429 and reaches no model', async () => {
    const { deps, fetchMock } = makeDeps({
      followup: { used: 3, limit: 300, tier: 'pro', allowed: false, reason: 'no_slot' },
      fetchImpl: () =>
        openrouter([{ name: 'update_expense', input: { expenseId: saved.id, place: 'X' } }]),
    });
    await expect(
      handleVoiceAgent(textRequest({ transcript: 'at Blue Tokai', savedExpense: saved }), deps),
    ).rejects.toMatchObject({ status: 429, code: 'VOICE_AGENT_FOLLOWUP_CAP' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('WAV-12 answer_question in a follow-up is a command', () => {
  it('a follow-up that only answers a question reserves a command and reports that quota', async () => {
    const { deps, rpc } = makeDeps({
      fetchImpl: () => openrouter([{ name: 'answer_question', input: { text: 'Ravi owes 400.' } }]),
    });
    const body = await (
      await handleVoiceAgent(textRequest({ transcript: 'who owes me', savedExpense: saved }), deps)
    ).json();
    expect(body.answer).toBe('Ravi owes 400.');
    expect(names(rpc)).toContain('waves_voice_agent_followup');
    expect(names(rpc)).toContain('waves_voice_agent_quota');
    expect(body.quota).toEqual({ used: 3, limit: 100, tier: 'pro' });
  });

  it('withholds the answer with 402 when the allowance is spent', async () => {
    const { deps } = makeDeps({
      quota: { used: 100, limit: 100, tier: 'pro', allowed: false, month: '2026-10' },
      fetchImpl: () => openrouter([{ name: 'answer_question', input: { text: 'Secret.' } }]),
    });
    await expect(
      handleVoiceAgent(textRequest({ transcript: 'who owes me', savedExpense: saved }), deps),
    ).rejects.toMatchObject({ status: 402, code: 'VOICE_AGENT_QUOTA' });
  });

  it('a correction (update) stays outside the command allowance', async () => {
    const { deps, rpc } = makeDeps({
      fetchImpl: () =>
        openrouter([
          { name: 'update_expense', input: { expenseId: saved.id, place: 'Blue Tokai' } },
        ]),
    });
    const body = await (
      await handleVoiceAgent(
        textRequest({ transcript: 'at Blue Tokai', savedExpense: saved }),
        deps,
      )
    ).json();
    expect(body.update).toEqual({ expenseId: saved.id, place: 'Blue Tokai' });
    expect(names(rpc)).not.toContain('waves_voice_agent_quota');
    expect(body.quota).toEqual({ used: 1, limit: 300, tier: 'pro' });
  });
});
