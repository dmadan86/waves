import { describe, expect, it } from 'vitest';

import {
  buildManifest,
  generatePrompts,
  nextUnrecorded,
  sessionIdFor,
  upsertItem,
  type RecorderGroup,
} from '../src/lib/voiceRecorderPure';
import {
  buildZip,
  crc32,
  pcmToWav,
  SILENCE_START,
  stepSilence,
} from '../src/lib/voiceRecorderAudio';

const groups: RecorderGroup[] = [
  { name: 'Goa trip', currency: 'INR', members: ['Priya', 'Karthik', 'Anbu', 'priya'] },
  { name: 'Flat', currency: 'INR', members: ['Meena', 'Rohit'] },
];

describe('generatePrompts', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = generatePrompts({ groups, seed: 7 });
    expect(generatePrompts({ groups, seed: 7 })).toEqual(a);
    expect(generatePrompts({ groups, seed: 8 }).map((p) => p.text)).not.toEqual(
      a.map((p) => p.text),
    );
  });

  it('makes about 40 prompts with the intended mix and unique ids', () => {
    const prompts = generatePrompts({ groups, seed: 1 });
    expect(prompts).toHaveLength(40);
    expect(new Set(prompts.map((p) => p.id)).size).toBe(40);
    expect(prompts.filter((p) => p.kind === 'name')).toHaveLength(25);
    expect(prompts.filter((p) => p.kind === 'amount')).toHaveLength(10);
    expect(prompts.filter((p) => p.kind === 'trap')).toHaveLength(5);
  });

  it('uses real member names and records them as expected', () => {
    const prompts = generatePrompts({ groups, seed: 3 });
    const real = new Set(['Priya', 'Karthik', 'Anbu', 'Meena', 'Rohit']);
    for (const p of prompts.filter((q) => q.kind === 'name')) {
      expect(p.expected.names.length).toBeGreaterThan(0);
      for (const name of p.expected.names) {
        expect(real.has(name)).toBe(true);
        expect(p.text).toContain(name);
      }
    }
  });

  it('puts the amount in minor units and nulls it for name-only prompts', () => {
    const prompts = generatePrompts({ groups, seed: 3 });
    const remind = prompts.find((p) => p.expected.role === 'remind');
    expect(remind?.expected.amountMinor).toBeNull();
    const paid = prompts.find((p) => p.expected.role === 'expense' && /paid \d+ for/.test(p.text));
    const spoken = Number(/paid (\d+) for/.exec(paid!.text)![1]);
    expect(paid!.expected.amountMinor).toBe(spoken * 100);
    const lakh = prompts.find((p) => p.text.startsWith('one point five lakh'));
    expect(lakh?.expected.amountMinor).toBe(15000000);
    const dedh = prompts.find((p) => p.text.startsWith('dedh sau'));
    expect(dedh?.expected.amountMinor).toBe(15000);
  });

  it('keeps traps free of names, and only the taxi trap has an amount', () => {
    const traps = generatePrompts({ groups, seed: 5 }).filter((p) => p.kind === 'trap');
    for (const trap of traps) {
      expect(trap.expected.names).toEqual([]);
      expect(trap.expected.role).toBe('none');
      expect(trap.expected.amountMinor === null).toBe(!trap.text.includes('200'));
    }
  });

  it('still gives a full session when there are no groups', () => {
    const prompts = generatePrompts({ groups: [], seed: 2 });
    expect(prompts.length).toBeGreaterThanOrEqual(12);
    expect(prompts.every((p) => p.kind !== 'name')).toBe(true);
  });

  it('does not charge minor units for zero-decimal currencies', () => {
    const prompts = generatePrompts({
      groups: [{ name: 'Tokyo', currency: 'JPY', members: ['Aki', 'Ben'] }],
      seed: 4,
    });
    const paid = prompts.find((p) => /paid \d+ for/.test(p.text))!;
    expect(paid.expected.amountMinor).toBe(Number(/paid (\d+) for/.exec(paid.text)![1]));
  });
});

describe('manifest', () => {
  const prompts = generatePrompts({ groups, seed: 1, count: 6 });
  const base = {
    sessionId: 's1',
    createdAt: '2026-10-07T00:00:00.000Z',
    speaker: { label: '  Madan · Tamil · Bangalore ', languageBackground: 'tamil', accent: null },
    device: {
      model: 'Pixel 8',
      os: 'android',
      osVersion: '15',
      appVersion: '1.0.0',
      locale: 'en-IN',
    },
    onDeviceSupported: false,
    prompts,
  };
  const item = (id: string, file = `${id}.wav`) => ({
    id,
    promptText: 'x',
    expected: { names: [], amountMinor: null, currency: null, role: 'none' as const },
    file,
    durationMs: 1000,
    recordedAt: '2026-10-07T00:00:01.000Z',
  });

  it('records speaker, device and audio format', () => {
    const m = buildManifest({ ...base, items: [item('p01')] });
    expect(m.speaker.label).toBe('Madan · Tamil · Bangalore');
    expect(m.device.model).toBe('Pixel 8');
    expect(m.audio).toEqual({ format: 'wav', sampleRate: 16000, channels: 1, bitDepth: 16 });
    expect(m.onDeviceRecognition).toBe('unsupported');
    expect(m.items[0]!.file).toBe('p01.wav');
  });

  it('replaces a re-recorded item and finds the next unrecorded prompt', () => {
    const once = upsertItem([], item('p01'));
    const twice = upsertItem(once, { ...item('p01'), durationMs: 2222 });
    expect(twice).toHaveLength(1);
    expect(twice[0]!.durationMs).toBe(2222);
    expect(nextUnrecorded(prompts, twice)).toBe(1);
    expect(
      nextUnrecorded(
        prompts,
        prompts.map((p) => item(p.id)),
      ),
    ).toBe(prompts.length);
  });

  it('names sessions safely', () => {
    expect(sessionIdFor(new Date('2026-10-07T01:02:03.456Z'))).toBe(
      'session-2026-10-07T01-02-03-456Z',
    );
  });
});

describe('audio helpers', () => {
  it('wraps PCM in a 44-byte WAV header', () => {
    const wav = pcmToWav(new Uint8Array(3200));
    const view = new DataView(wav.buffer);
    expect(wav.length).toBe(3244);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(3200);
  });

  it('stops after 2 s of silence once speech was heard, not before', () => {
    let state = SILENCE_START;
    let stop: string | null = null;
    for (let i = 0; i < 5; i++) ({ state, stop } = stepSilence(state, 0.5, 100));
    expect(stop).toBeNull();
    for (let i = 0; i < 19; i++) ({ state, stop } = stepSilence(state, 0, 100));
    expect(stop).toBeNull();
    ({ stop } = stepSilence(state, 0, 100));
    expect(stop).toBe('silence');
  });

  it('gives up when nobody speaks', () => {
    let state = SILENCE_START;
    let stop: string | null = null;
    for (let i = 0; i < 80; i++) ({ state, stop } = stepSilence(state, 0, 100));
    expect(stop).toBe('no-speech');
  });

  it('computes the standard crc32 and a well-formed zip', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const zip = buildZip([{ name: 'a/b.txt', bytes: new TextEncoder().encode('hi') }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1);
  });
});
