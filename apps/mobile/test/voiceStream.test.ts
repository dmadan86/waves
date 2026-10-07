import { describe, expect, it } from 'vitest';

import {
  applyMessage,
  base64ToBytes,
  EMPTY_TRANSCRIPT,
  fullText,
  liveText,
  parseMessage,
  pcmLevel,
  streamAlternatives,
  streamTokenFailure,
} from '@/lib/voiceStreamPure';

const result = (transcript: string, isFinal: boolean): string =>
  JSON.stringify({
    type: 'Results',
    is_final: isFinal,
    channel: { alternatives: [{ transcript }] },
  });

describe('Deepgram transcript assembly', () => {
  it('replaces the interim and concatenates the finals', () => {
    let state = applyMessage(EMPTY_TRANSCRIPT, result('add five', false));
    expect(liveText(state)).toBe('add five');
    state = applyMessage(state, result('add five hundred', false));
    expect(liveText(state)).toBe('add five hundred');
    state = applyMessage(state, result('add 500 to Goa', true));
    expect(state.finals).toEqual(['add 500 to Goa']);
    expect(state.interim).toBe('');
    state = applyMessage(state, result('and', false));
    expect(liveText(state)).toBe('add 500 to Goa and');
    state = applyMessage(state, result('and 200 for tea', true));
    expect(fullText(state)).toBe('add 500 to Goa and 200 for tea');
  });

  it('keeps an unfinalised tail in the full text', () => {
    const state = applyMessage(
      applyMessage(EMPTY_TRANSCRIPT, result('paid 300', true)),
      result('for lunch', false),
    );
    expect(fullText(state)).toBe('paid 300 for lunch');
  });

  it('ignores non-result messages, junk and empty finals', () => {
    const state = applyMessage(EMPTY_TRANSCRIPT, result('hello', true));
    expect(applyMessage(state, JSON.stringify({ type: 'Metadata' }))).toBe(state);
    expect(applyMessage(state, JSON.stringify({ type: 'UtteranceEnd' }))).toBe(state);
    expect(applyMessage(state, 'not json')).toBe(state);
    expect(applyMessage(state, new ArrayBuffer(4))).toBe(state);
    expect(applyMessage(state, result('', true)).finals).toEqual(['hello']);
    expect(parseMessage('[1]')).not.toBeNull();
    expect(parseMessage('{')).toBeNull();
  });
});

const ranked = (transcripts: string[], isFinal: boolean): string =>
  JSON.stringify({
    type: 'Results',
    is_final: isFinal,
    channel: { alternatives: transcripts.map((transcript) => ({ transcript })) },
  });

describe('Deepgram alternatives', () => {
  it('are empty when the stream sends one alternative per segment', () => {
    let state = applyMessage(EMPTY_TRANSCRIPT, result('paid 500 to Ravi', true));
    state = applyMessage(state, result('for tea', false));
    expect(streamAlternatives(state)).toEqual([]);
  });

  it('turn channel.alternatives[1..] into whole-sentence hypotheses, best first', () => {
    let state = applyMessage(EMPTY_TRANSCRIPT, ranked(['paid fifteen', 'paid fifty'], true));
    state = applyMessage(state, ranked(['to Renny', 'to rainy', 'to Renny'], true));
    expect(fullText(state)).toBe('paid fifteen to Renny');
    expect(streamAlternatives(state)).toEqual(['paid fifty to Renny', 'paid fifteen to rainy']);
  });

  it('follow the interim tail and drop a spent one', () => {
    let state = applyMessage(EMPTY_TRANSCRIPT, ranked(['paid 15', 'paid 50'], false));
    expect(streamAlternatives(state)).toEqual(['paid 50']);
    state = applyMessage(state, ranked(['paid 15 for tea'], true));
    expect(streamAlternatives(state)).toEqual([]);
  });
});

describe('PCM helpers', () => {
  it('decodes base64, with and without padding', () => {
    expect([...base64ToBytes('AQID')]).toEqual([1, 2, 3]);
    expect([...base64ToBytes('AQI=')]).toEqual([1, 2]);
    expect([...base64ToBytes('AQ')]).toEqual([1]);
    expect(base64ToBytes('').length).toBe(0);
  });

  it('measures loudness of 16-bit little-endian PCM', () => {
    expect(pcmLevel(new Uint8Array(0))).toBe(0);
    expect(pcmLevel(new Uint8Array(200))).toBe(0);
    const loud = new Uint8Array(200);
    for (let i = 0; i < 100; i++) {
      const value = i % 2 ? -20000 : 20000;
      loud[i * 2] = value & 0xff;
      loud[i * 2 + 1] = (value >> 8) & 0xff;
    }
    expect(pcmLevel(loud)).toBeGreaterThan(0.9);
  });
});

describe('streamTokenFailure', () => {
  it('reads any 402 as the monthly limit, whatever its code', () => {
    expect(streamTokenFailure(402)).toBe('quota');
  });

  it('reads everything else as a plain failure (shown as offline)', () => {
    expect(streamTokenFailure(503)).toBe('error');
    expect(streamTokenFailure(429)).toBe('error');
    expect(streamTokenFailure(null)).toBe('error');
    expect(streamTokenFailure(undefined)).toBe('error');
  });
});
