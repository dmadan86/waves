/**
 * The capture redesign's wiring on the voice screen, read from source (the
 * screen itself needs a native renderer this suite does not stand up): the
 * save is single-flight, the flow state is derived from the screen's own
 * phases, the mic panel is the reducer, and nothing simulates audio.
 */

import { readFileSync } from 'node:fs';
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

  it('VW-09: one stage stays mounted after the sentence; cards arrive under it', () => {
    expect(voice).toContain("phase !== 'listening' ? (");
    expect(voice).toContain('stageStatusKey(stageInput)');
    expect(voice).toContain('onStage={setAgentStage}');
    expect(voice).toContain('scrollRef.current?.scrollTo');
    expect(voice).not.toContain('<VoiceStatus');
    expect(voice).not.toContain('<LiveTranscript');
    expect(voice).not.toContain('t.voice.ansTitle');
    expect(src('components/voice/StageAppear.tsx')).toContain('if (reduceMotion)');
    expect(src('components/VoiceAgentPanel.tsx')).not.toContain('VoiceMicOrb');
  });

  it('VW-08: Home’s time-of-day scene replaces the old desk footer', () => {
    expect(voice).toContain('<VoiceSceneBackdrop />');
    expect(voice).not.toContain('VoiceFooterScene');
  });
});
