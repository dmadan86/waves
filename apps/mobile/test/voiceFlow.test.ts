import { describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_IDLE,
  captureReducer,
  initialCapture,
  voiceFlowState,
  voiceStatusKey,
  statusAnnouncement,
  micButtonMode,
  showSuggestions,
  pushLevel,
  EMPTY_LEVELS,
  LEVEL_BARS,
  LEVEL_MIN_GAP_MS,
  singleFlight,
  type CaptureState,
  type VoiceFlowInput,
  type VoiceFlowState,
} from '../src/lib/voiceFlowPure';

const listening = { ...CAPTURE_IDLE, mic: 'listening' } as const;
const flow = (capture: CaptureState) => voiceFlowState({ phase: 'listening', capture });

describe('capture reducer', () => {
  it('VF-01: initializes automatic and manual capture', () => {
    expect(initialCapture(false)).toBe(CAPTURE_IDLE);
    expect(initialCapture(true)).toEqual({ ...CAPTURE_IDLE, mic: 'starting' });
  });
  it('VF-02: start clears old words, final flag and problems; opened is idempotent', () => {
    const dirty: CaptureState = {
      mic: 'idle',
      transcript: 'old',
      final: true,
      problem: { kind: 'error', message: 'failed' },
    };
    const starting = captureReducer(dirty, { type: 'start' });
    expect(starting).toEqual(initialCapture(true));
    const open = captureReducer(starting, { type: 'opened' });
    expect(open).toEqual(listening);
    expect(captureReducer(open, { type: 'opened' })).toBe(open);
  });
  it('VF-03: partial updates preserve mic and identical partials preserve identity', () => {
    const partial = captureReducer(listening, { type: 'partial', text: 'coffee' });
    expect(partial).toEqual({ ...listening, transcript: 'coffee' });
    expect(captureReducer(partial, { type: 'partial', text: 'coffee' })).toBe(partial);
    const final = captureReducer(partial, { type: 'final', text: 'coffee 80' });
    expect(final).toEqual({ ...CAPTURE_IDLE, transcript: 'coffee 80', final: true });
    expect(captureReducer(final, { type: 'partial', text: 'coffee 80' }).final).toBe(false);
  });
  it('VF-04: noSpeech clears words and error distinguishes permission/settings', () => {
    const state = { ...listening, transcript: 'old' };
    expect(captureReducer(state, { type: 'noSpeech' })).toEqual({
      ...CAPTURE_IDLE,
      problem: { kind: 'no-speech' },
    });
    for (const settings of [true, false, undefined]) {
      expect(
        captureReducer(state, { type: 'error', permission: true, settings, message: 'Denied' }),
      ).toEqual({
        ...state,
        mic: 'idle',
        problem: { kind: 'permission', message: 'Denied', settings: settings === true },
      });
    }
    expect(captureReducer(state, { type: 'error', message: 'Offline', settings: true })).toEqual({
      ...state,
      mic: 'idle',
      problem: { kind: 'error', message: 'Offline' },
    });
  });
  it('VF-05: settled resets only starting, closed keeps words, cancel resets everything', () => {
    expect(captureReducer(initialCapture(true), { type: 'settled' })).toEqual(CAPTURE_IDLE);
    for (const state of [CAPTURE_IDLE, listening])
      expect(captureReducer(state, { type: 'settled' })).toBe(state);
    const partial = { ...listening, transcript: 'coffee' };
    const closed = captureReducer(partial, { type: 'closed' });
    expect(closed).toEqual({ ...partial, mic: 'idle' });
    expect(captureReducer(closed, { type: 'closed' })).toBe(closed);
    expect(captureReducer(partial, { type: 'cancel' })).toBe(CAPTURE_IDLE);
  });
});

describe('screen flow', () => {
  it('VF-06: opening and closing an empty screen stays idle; granted permission starts listening', () => {
    expect(voiceFlowState({ phase: 'listening' })).toBe('idle');
    expect(voiceFlowState({ phase: 'listening', capture: null })).toBe('idle');
    expect(flow(captureReducer(CAPTURE_IDLE, { type: 'closed' }))).toBe('idle');
    const start = captureReducer(CAPTURE_IDLE, { type: 'start' });
    expect(flow(start)).toBe('listening');
    expect(flow(captureReducer(start, { type: 'opened' }))).toBe('listening');
    expect(flow(captureReducer(listening, { type: 'closed' }))).toBe('idle');
    expect(flow(captureReducer(listening, { type: 'cancel' }))).toBe('idle');
  });
  it.each([
    [{ type: 'error', permission: true, message: 'Denied' }, 'permission_required'],
    [{ type: 'error', message: 'Failed' }, 'error'],
    [{ type: 'noSpeech' }, 'no_speech'],
  ] as const)('VF-07: capture event %j leads to %s', (event, expected) => {
    expect(flow(captureReducer(listening, event))).toBe(expected);
  });
  it('VF-08: partial then final words process equally on device and cloud closed-then-final paths', () => {
    const partial = captureReducer(listening, { type: 'partial', text: 'coffee' });
    expect(flow(partial)).toBe('listening');
    const closed = captureReducer(partial, { type: 'closed' });
    expect(flow(closed)).toBe('processing');
    const final = { type: 'final', text: 'coffee 80' } as const;
    const device = captureReducer(partial, final);
    const cloud = captureReducer(closed, final);
    expect(cloud).toEqual(device);
    expect(flow(device)).toBe('processing');
    expect(flow(cloud)).toBe('processing');
    expect(flow({ ...CAPTURE_IDLE, transcript: '   ' })).toBe('idle');
  });
  it('VF-09: parsed miss says noAmount; actual no speech takes precedence', () => {
    const input: VoiceFlowInput = {
      phase: 'listening',
      missed: true,
      capture: { ...CAPTURE_IDLE, transcript: 'coffee', final: true },
    };
    expect(voiceFlowState(input)).toBe('no_speech');
    expect(voiceStatusKey('no_speech', input)).toBe('noAmount');
    expect(
      voiceStatusKey('no_speech', {
        ...input,
        capture: captureReducer(listening, { type: 'noSpeech' }),
      }),
    ).toBe('noSpeech');
  });
  it.each([
    [{ phase: 'review' }, 'preview', 'expenseReady'],
    [{ phase: 'review', needsAnswer: true }, 'clarification_required', 'check'],
    [{ phase: 'answer' }, 'preview', 'expenseReady'],
    [{ phase: 'review', saving: true, needsAnswer: true }, 'saving', 'saving'],
    [{ phase: 'review', saved: true, saving: true }, 'success', 'saved'],
    [{ phase: 'committing' }, 'saving', 'saving'],
    [{ phase: 'agent' }, 'processing', 'processing'],
    [{ phase: 'thinking' }, 'processing', 'processing'],
  ] satisfies [VoiceFlowInput, VoiceFlowState, string][])(
    'VF-10: phase %j gives %s and status %s',
    (input, state, status) => {
      expect(voiceFlowState(input)).toBe(state);
      expect(voiceStatusKey(state, input)).toBe(status);
    },
  );
  it.each(['participants', 'amounts'])('VF-11: ambiguous %s require clarification', () => {
    const input: VoiceFlowInput = { phase: 'review', needsAnswer: true };
    expect(voiceFlowState(input)).toBe('clarification_required');
    expect(voiceStatusKey(voiceFlowState(input), input)).toBe('check');
  });
  it('VF-12: navigating away while recording cancels so no transcript can leak', () => {
    const recording = captureReducer(listening, { type: 'partial', text: 'private coffee 80' });
    const away = captureReducer(recording, { type: 'cancel' });
    expect(away).toBe(CAPTURE_IDLE);
    expect(away.transcript).toBe('');
    expect(flow(away)).toBe('idle');
  });
  it('VF-13: active mic takes precedence over stale problems and saved wins in every phase', () => {
    for (const mic of ['starting', 'listening'] as const) {
      for (const problem of [
        null,
        { kind: 'no-speech' },
        { kind: 'error', message: 'Oops' },
        { kind: 'permission', message: 'Denied', settings: true },
      ] as const) {
        expect(flow({ mic, transcript: 'coffee', final: false, problem })).toBe('listening');
      }
    }
    for (const phase of [
      'listening',
      'thinking',
      'review',
      'committing',
      'answer',
      'agent',
    ] as const)
      expect(voiceFlowState({ phase, saved: true })).toBe('success');
  });
});

const states = [
  ['idle', 'ready', 'start'],
  ['listening', 'listening', 'stop'],
  ['processing', 'processing', 'busy'],
  ['preview', 'expenseReady', 'start'],
  ['saving', 'saving', 'busy'],
  ['success', 'saved', 'busy'],
  ['permission_required', 'permission', 'retry'],
  ['error', 'error', 'retry'],
  ['no_speech', 'noSpeech', 'retry'],
  ['clarification_required', 'check', 'start'],
] as const;
it.each(states)('VF-14: %s has status %s and mic mode %s', (state, status, mode) => {
  expect(voiceStatusKey(state, { phase: 'listening', capture: listening })).toBe(status);
  expect(micButtonMode(state)).toBe(mode);
  expect(showSuggestions(state, '')).toBe(state === 'idle' || state === 'no_speech');
  expect(showSuggestions(state, 'coffee')).toBe(false);
});
it('VF-15: starting status and announcements only announce nonempty changes', () => {
  expect(voiceStatusKey('listening', { phase: 'listening', capture: initialCapture(true) })).toBe(
    'starting',
  );
  expect(statusAnnouncement(null, 'Listening')).toBe('Listening');
  expect(statusAnnouncement('Listening', 'Processing')).toBe('Processing');
  expect(statusAnnouncement('Processing', 'Processing')).toBeNull();
  expect(statusAnnouncement('Processing', '')).toBeNull();
  expect(statusAnnouncement(null, '')).toBeNull();
});
it('VF-16: levels stay real, clamp, throttle by identity and retain a fixed history length', () => {
  expect(EMPTY_LEVELS.values).toEqual(Array(LEVEL_BARS).fill(0));
  let history = pushLevel(EMPTY_LEVELS, 0.4, 0);
  expect(history.values).toEqual([...Array(LEVEL_BARS - 1).fill(0), 0.4]);
  expect(pushLevel(history, 0.9, LEVEL_MIN_GAP_MS - 1)).toBe(history);
  for (const [index, value] of [2, -1, NaN, 0.7].entries()) {
    history = pushLevel(history, value, (index + 1) * LEVEL_MIN_GAP_MS);
    expect(history.values).toHaveLength(LEVEL_BARS);
    expect(history.values.at(-1)).toBe([1, 0, 0, 0.7][index]);
  }
  expect(history.values.slice(-5)).toEqual([0.4, 1, 0, 0, 0.7]);
});
it('VF-17: singleFlight refuses a double tap and allows another job after resolution', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const job = vi.fn(() => pending);
  const gate = singleFlight();
  expect(gate.busy).toBe(false);
  const first = gate.run(job);
  expect(gate.busy).toBe(true);
  expect(await gate.run(job)).toBe(false);
  expect(job).toHaveBeenCalledTimes(1);
  finish();
  expect(await first).toBe(true);
  expect(gate.busy).toBe(false);
  expect(await gate.run(job)).toBe(true);
  expect(job).toHaveBeenCalledTimes(2);
});
it('VF-18: a rejected save rethrows and releases the gate for retry', async () => {
  const gate = singleFlight();
  const error = new Error('Save failed');
  await expect(
    gate.run(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(gate.busy).toBe(false);
  const retry = vi.fn(async () => {});
  expect(await gate.run(retry)).toBe(true);
  expect(retry).toHaveBeenCalledTimes(1);
});

it('VF-19: an error followed by an empty end keeps the error and its recovery', () => {
  for (const event of [
    { type: 'error', message: 'Denied', permission: true, settings: true },
    { type: 'error', message: 'Recogniser busy' },
  ] as const) {
    const failed = captureReducer(listening, event);
    const ended = captureReducer(failed, { type: 'noSpeech' });
    expect(ended.problem).toEqual(failed.problem);
    expect(ended.mic).toBe('idle');
    expect(flow(ended)).toBe(
      event.type === 'error' && 'permission' in event ? 'permission_required' : 'error',
    );
  }
  // A later tap starts clean.
  expect(
    captureReducer(captureReducer(listening, { type: 'noSpeech' }), { type: 'start' }).problem,
  ).toBeNull();
});
