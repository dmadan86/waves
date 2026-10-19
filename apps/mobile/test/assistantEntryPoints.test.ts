/**
 * Where the assistant can be reached from (spec 2.2), read as source.
 *
 * The screens pull in react-native and native modules this node suite cannot
 * load, and what is worth protecting is a structural fact: the entry exists and
 * hands the voice screen the right words. Same approach as
 * personalNoteField.test.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = (path: string): string => readFileSync(join(__dirname, '../src', path), 'utf8');

describe('entry points', () => {
  it('2: the voice screen has a typed composer behind a keyboard glyph on the mic', () => {
    const voice = src('app/voice.tsx');
    expect(voice).toContain('<AssistantComposer');
    expect(voice).toContain('keypad-outline');
    expect(voice).toContain('t.assistant.composerTypeInstead');
    expect(voice).toContain('typed: true');
  });

  it('3: Quick add opens the voice screen tagged as quick', () => {
    expect(src('components/QuickAddSheet.tsx')).toMatch(
      /pathname: '\/voice',\s*params: \{ source: 'quick' \}/,
    );
  });

  it('4: the personal transactions header opens the assistant on the private ledger', () => {
    const transactions = src('app/personal/transactions.tsx');
    expect(transactions).toContain('sparkles-outline');
    expect(transactions).toMatch(/pathname: '\/voice'[\s\S]{0,40}scope: 'personal'/);
    expect(src('app/voice.tsx')).toContain("params.scope === 'personal'");
  });

  it('5: the expense detail screen offers "Complete this expense" to Pro, not on a deleted bill', () => {
    const detail = src('app/group/[id]/expense/[expenseId].tsx');
    expect(detail).toContain('<AssistantCompleteRow');
    expect(detail).toMatch(/!deleted \? \(\s*<AssistantCompleteRow/);
    expect(detail).toContain('isPro={isPro}');
    expect(src('components/AssistantCompleteRow.tsx')).toContain(
      'if (!isPro || gaps.length === 0) return null',
    );
  });

  it('6: the plans screen lists the assistant’s follow-ups with an AI pill', () => {
    const paywall = src('app/paywall.tsx');
    expect(paywall).toContain('t.assistant.planRowTitle');
    expect(paywall).toContain('t.assistant.planRowPill');
  });

  it('the Free teaser replaces the follow-ups for Free and the intro sits above them for Pro', () => {
    const voice = src('app/voice.tsx');
    expect(voice).toContain('renderAfterSave={isPro ? undefined : renderFreeAfterSave}');
    expect(voice).toContain('aboveFollowUps={<AssistantIntro');
    const panel = src('components/VoiceAgentPanel.tsx');
    expect(panel).toContain('renderAfterSave');
    expect(panel).toContain('aboveFollowUps');
  });

  it('S-ONB-03: the "Try saying" card has a 4th example, "Who owes me?"', () => {
    expect(src('components/VoiceCapture.tsx')).toContain('t.assistant.tryWhoOwes');
  });

  it('an unknown plan is not a Free plan: the teaser waits for the entitlement read', () => {
    expect(src('app/voice.tsx')).toContain('entitlement.isPro || entitlement.loading');
  });
});

describe('telemetry is wired on the voice screen', () => {
  const voice = src('app/voice.tsx');

  it('reports the visit, each command and each answered balance question', () => {
    expect(voice).toContain("trackAssistant('assistant_opened'");
    expect(voice).toContain("trackAssistant('assistant_command'");
    expect(voice).toContain("trackAssistant('assistant_question_answered'");
  });

  it('never puts the words that were said into an event', () => {
    const calls = voice.match(/trackAssistant\([^)]*\)/gs) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls)
      expect(call).not.toMatch(/(transcript|lastTyped|typedDraft|text|answer)/);
  });
});
