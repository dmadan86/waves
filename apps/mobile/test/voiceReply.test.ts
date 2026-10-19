/**
 * Answering a follow-up by voice: the clip rules, the chip matcher and the
 * `useVoiceReply` hook (idle → listening → transcribing → answered), driven
 * through the synchronous fake React with a stand-in engine.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, renderHook } from './support/fakeReact';

import {
  FOLLOW_UP_TURN_CAP,
  REPLY_MAX_MS,
  matchChip,
  normaliseAnswer,
  replyGate,
} from '@/lib/voiceReplyPure';
import type { ReplyEngine, ReplyHandlers, ReplyRun } from '@/lib/voiceReplyEngine';
import { useVoiceReply, type UseVoiceReplyInput } from '@/lib/useVoiceReply';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());
vi.mock('@/lib/voiceReplyEngine', () => ({ deviceReplyEngine: { supported: () => true } }));

interface Fake {
  engine: ReplyEngine;
  handlers: ReplyHandlers | null;
  run: { stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
  starts: number;
  supported: boolean;
}

function fakeEngine(): Fake {
  const fake: Fake = {
    handlers: null,
    run: { stop: vi.fn(), cancel: vi.fn() },
    starts: 0,
    supported: true,
    engine: {
      supported: () => fake.supported,
      start: (_context, handlers) => {
        fake.starts += 1;
        fake.handlers = handlers;
        return fake.run as ReplyRun;
      },
    },
  };
  return fake;
}

let fake: Fake;
const heard: string[] = [];
const inputFor = (over: Partial<UseVoiceReplyInput> = {}): UseVoiceReplyInput => ({
  onTranscript: (text) => heard.push(text),
  groupId: 'g1',
  locale: 'en-IN',
  online: true,
  turnsUsed: 0,
  engine: fake.engine,
  ...over,
});

beforeEach(() => {
  fake = fakeEngine();
  heard.length = 0;
});

describe('voice reply rules', () => {
  it('MC-VR-01 a clip is capped at 6 s and the turn cap is 3', () => {
    expect(REPLY_MAX_MS).toBe(6000);
    expect(FOLLOW_UP_TURN_CAP).toBe(3);
  });

  it('MC-VR-02 the gate hides the mic offline, at the cap, or without a recorder', () => {
    expect(replyGate({ online: true, turnsUsed: 0, supported: true })).toBeNull();
    expect(replyGate({ online: false, turnsUsed: 0, supported: true })).toBe('offline');
    expect(replyGate({ online: true, turnsUsed: 3, supported: true })).toBe('cap');
    expect(replyGate({ online: true, turnsUsed: 0, supported: false })).toBe('unsupported');
  });

  it('MC-VR-03 matchChip names one chip from a short answer, else none', () => {
    const payment = [
      { label: 'Cash', primary: true },
      { label: 'UPI', primary: true },
      { label: 'Credit card', primary: true },
    ];
    expect(matchChip('  Cash. ', payment)).toBe(0);
    expect(matchChip('I paid by UPI', payment)).toBe(1);
    expect(matchChip('cash or upi', payment)).toBe(-1);
    expect(matchChip('yes', payment)).toBe(-1);
    expect(matchChip('', payment)).toBe(-1);
    const yesNo = [{ label: 'Yes, move it', primary: true }, { label: 'No, personal' }];
    expect(matchChip('yeah', yesNo)).toBe(0);
    expect(matchChip('nope', yesNo)).toBe(1);
    const place = [{ label: 'Blue Tokai', primary: true }, { label: 'Somewhere else' }];
    expect(matchChip('no', place)).toBe(-1);
    expect(normaliseAnswer('Café, déjà vu!')).toBe('cafe deja vu');
  });
});

describe('useVoiceReply', () => {
  it('MC-VR-10 idle -> listening -> transcribing -> answered', () => {
    const hook = renderHook(() => useVoiceReply(inputFor()));
    expect(hook.result.current.phase).toBe('idle');
    expect(hook.result.current.off).toBeNull();
    act(() => hook.result.current.start());
    expect(fake.starts).toBe(1);
    expect(hook.result.current.phase).toBe('listening');
    act(() => fake.handlers?.onText?.('cash'));
    expect(hook.result.current.live).toBe('cash');
    act(() => fake.handlers?.onCaptured());
    expect(hook.result.current.phase).toBe('transcribing');
    act(() => fake.handlers?.onEnd({ kind: 'text', text: 'cash' }));
    expect(hook.result.current.phase).toBe('idle');
    expect(hook.result.current.live).toBe('');
    expect(heard).toEqual(['cash']);
  });

  it('MC-VR-11 a second tap while listening does not open a second clip', () => {
    const hook = renderHook(() => useVoiceReply(inputFor()));
    act(() => hook.result.current.start());
    act(() => hook.result.current.start());
    expect(fake.starts).toBe(1);
    act(() => hook.result.current.stop());
    expect(fake.run.stop).toHaveBeenCalledTimes(1);
  });

  it('MC-VR-12 a refused microphone reports denied and sends nothing', () => {
    const hook = renderHook(() => useVoiceReply(inputFor()));
    act(() => hook.result.current.start());
    act(() => fake.handlers?.onEnd({ kind: 'denied' }));
    expect(hook.result.current.phase).toBe('idle');
    expect(hook.result.current.problem).toBe('denied');
    expect(heard).toEqual([]);
    // Trying again clears the problem.
    act(() => hook.result.current.start());
    expect(hook.result.current.problem).toBeNull();
    expect(hook.result.current.phase).toBe('listening');
  });

  it('MC-VR-13 offline: no mic, start does nothing', () => {
    const hook = renderHook(() => useVoiceReply(inputFor({ online: false })));
    expect(hook.result.current.off).toBe('offline');
    act(() => hook.result.current.start());
    expect(fake.starts).toBe(0);
    expect(hook.result.current.phase).toBe('idle');
  });

  it('MC-VR-14 going offline mid-clip drops the clip', () => {
    const hook = renderHook((p: UseVoiceReplyInput) => useVoiceReply(p), {
      props: inputFor(),
    });
    act(() => hook.result.current.start());
    hook.rerender(inputFor({ online: false }));
    expect(fake.run.cancel).toHaveBeenCalledTimes(1);
    expect(hook.result.current.phase).toBe('idle');
  });

  it('MC-VR-15 unmount stops the recorder and a late result is ignored', () => {
    const hook = renderHook(() => useVoiceReply(inputFor()));
    act(() => hook.result.current.start());
    const late = fake.handlers;
    hook.unmount();
    expect(fake.run.cancel).toHaveBeenCalledTimes(1);
    late?.onEnd({ kind: 'text', text: 'too late' });
    expect(heard).toEqual([]);
  });

  it('MC-VR-16 an empty transcript is a retry hint, not an answer', () => {
    const hook = renderHook(() => useVoiceReply(inputFor()));
    act(() => hook.result.current.start());
    act(() => fake.handlers?.onEnd({ kind: 'empty' }));
    expect(hook.result.current.problem).toBe('empty');
    expect(heard).toEqual([]);
    act(() => hook.result.current.start());
    expect(fake.starts).toBe(2);
  });

  it('MC-VR-17 at the turn cap the mic is off and start does nothing', () => {
    const hook = renderHook(() => useVoiceReply(inputFor({ turnsUsed: 3 })));
    expect(hook.result.current.off).toBe('cap');
    act(() => hook.result.current.start());
    expect(fake.starts).toBe(0);
  });

  it('MC-VR-18 a build without a recorder hides the mic', () => {
    fake.supported = false;
    const hook = renderHook(() => useVoiceReply(inputFor()));
    expect(hook.result.current.off).toBe('unsupported');
  });

  it('MC-VR-19 cancel frees the recorder and returns to idle', () => {
    const hook = renderHook(() => useVoiceReply(inputFor()));
    act(() => hook.result.current.start());
    act(() => hook.result.current.cancel());
    expect(fake.run.cancel).toHaveBeenCalledTimes(1);
    expect(hook.result.current.phase).toBe('idle');
  });
});
