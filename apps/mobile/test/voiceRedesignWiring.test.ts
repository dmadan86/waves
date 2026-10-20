/**
 * The capture redesign's wiring on the voice screen, read from source (the
 * screen itself needs a native renderer this suite does not stand up): the
 * save is single-flight, the flow state is derived from the screen's own
 * phases, the mic panel is the reducer, and nothing simulates audio.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = (path: string): string => readFileSync(join(__dirname, '../src', path), 'utf8');

describe('voice screen redesign wiring', () => {
  const voice = src('app/voice.tsx');
  const capture = src('components/VoiceCapture.tsx');

  it('VW-01: double tap on Add expense is one save (single-flight gate)', () => {
    expect(voice).toContain('saveGate.run(saveOnce)');
    expect(voice).toMatch(/useState\(singleFlight\)/);
  });

  it('VW-02: the review state is derived from the existing phase, not a parallel copy', () => {
    expect(voice).toContain('needsAnswer: whoBlocked,');
    expect(voice).toContain('agent: agentStage,');
    expect(voice).not.toMatch(/useState<VoiceFlowState>/);
  });

  it('VW-03: the mic panel keeps its mic state in the pure reducer only', () => {
    expect(capture).toContain('useReducer(');
    expect(capture).toContain('captureReducer');
    for (const gone of ['setListening', 'setPreparing', 'setEmptyMiss', 'setErrorInSettings'])
      expect(capture).not.toContain(gone);
  });

  it('VW-04: the wave rides the eased input level and honours reduced motion', () => {
    const wave = src('components/voice/AudioWaveform.tsx');
    expect(wave).not.toMatch(/setInterval|requestAnimationFrame|Math\.random/);
    expect(wave).toContain('duration: 2400');
    expect(wave).toContain('reduceMotion ? <StaticWave');
    expect(capture).toContain('level.set(withTiming(value, { duration: 90 }))');
    expect(capture).not.toMatch(/levelHistory|pushLevel/);
  });

  it('VW-05: leaving while recording releases the mic and cancels the stream', () => {
    expect(capture).toMatch(
      /return \(\) => \{[\s\S]*stream\.current\?\.cancel\(\);[\s\S]*speechMic\.release\(session\);/,
    );
  });

  it('VW-06: a stale interpretation is dropped and Edit text bumps the token', () => {
    expect(voice).toContain('if (interpretToken.current !== token) return;');
    expect(voice).toMatch(
      /const editHeard = \(\): void => \{[\s\S]*interpretToken\.current \+= 1;/,
    );
  });

  it('VW-07: "Who owes me?" is a button only where the assistant can answer it', () => {
    expect(voice).toContain("suggestion.kind === 'expense' || agentOn");
  });

  it('VW-09: one stage stays mounted after the sentence; cards change in place under it', () => {
    expect(voice).toContain("phase !== 'listening' ? (");
    expect(voice).toContain('stageStatusKey(stageInput)');
    // The stage (headline, mic, status, wave) is drawn once, in the one scroll, until
    // a card is answering; the mic panel reports its state up and draws only the
    // words and the examples.
    expect(voice.match(/<VoiceTop/g)).toHaveLength(1);
    expect(voice).toContain('onStage={setCapStage}');
    expect(voice).toContain("(phase === 'agent' && agentStage !== 'working')");
    expect(voice).toContain('{!stageSettled ? (');
    expect(capture).not.toContain('<VoiceTop');
    expect(voice).toContain('onStage={setAgentStage}');
    expect(voice).toContain('onFooter={setPanelFooter}');
    // Content updates in place: no scroll jumps, no per-phase fade or rise.
    expect(voice).not.toContain('scrollTo');
    expect(voice).not.toContain('StageAppear');
    expect(voice).not.toContain('<VoiceStatus');
    expect(voice).not.toContain('<LiveTranscript');
    expect(voice).not.toContain('t.voice.ansTitle');
    expect(existsSync(join(__dirname, '../src/components/voice/StageAppear.tsx'))).toBe(false);
    expect(src('components/VoiceAgentPanel.tsx')).not.toContain('VoiceMicOrb');
  });

  it('VW-10: one footer area holds the action in every step, and nothing else says Add', () => {
    expect(voice).toContain('<VoiceFooter spec={footerSpec} inset={insets.bottom} />');
    expect(voice).not.toContain('<SavedActions');
    expect(voice).not.toContain('onTypeInstead');
    expect(src('components/voice/VoiceFooter.tsx')).toContain('height: 48');
    expect(src('components/voice/VoiceFooter.tsx')).toContain('height: 44');
    // The confirmation card and the list report their button up instead of drawing one.
    expect(src('components/VoiceConfirmCard.tsx')).toContain('useReportFooter(onFooter');
    expect(src('components/VoiceConfirmCard.tsx')).not.toContain('agentTryAgain');
    expect(src('components/VoiceAgentPanel.tsx')).toContain('useReportFooter(');
  });

  it('VW-08: the full-bleed scene photo is the background; the old strip is gone', () => {
    expect(voice).toContain('<VoiceScene />');
    expect(voice).not.toContain('sheetTop');
    expect(voice).not.toContain('borderTopLeftRadius: 28');
    expect(voice).not.toContain('VoiceSceneBackdrop');
    expect(existsSync(join(__dirname, '../src/components/voice/VoiceSceneBackdrop.tsx'))).toBe(false);
    expect(voice).not.toContain('VoiceFooterScene');
  });
});
