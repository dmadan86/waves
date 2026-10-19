/**
 * Answer a follow-up question by voice: idle → listening → transcribing → the
 * transcript handed to `onTranscript`, the same function a typed answer goes
 * through. One clip at a time; the recorder is closed on stop, cancel and
 * unmount, so a card that goes away never leaves the mic open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { deviceReplyEngine, type ReplyEngine, type ReplyRun } from '@/lib/voiceReplyEngine';
import { replyGate, type ReplyPhase, type ReplyProblem } from '@/lib/voiceReplyPure';

export interface UseVoiceReplyInput {
  onTranscript: (text: string) => void;
  groupId: string | null;
  locale: string;
  online: boolean;
  /** Model turns this expense has used so far. */
  turnsUsed: number;
  engine?: ReplyEngine;
}

export interface VoiceReply {
  phase: ReplyPhase;
  /** Words heard so far in this clip. */
  live: string;
  problem: ReplyProblem | null;
  /** Why the mic is off, or null when it can be used. */
  off: 'offline' | 'cap' | 'unsupported' | null;
  start: () => void;
  /** End the clip now and use what was heard. */
  stop: () => void;
  /** Drop the clip without using it. */
  cancel: () => void;
}

export function useVoiceReply(input: UseVoiceReplyInput): VoiceReply {
  const engine = input.engine ?? deviceReplyEngine;
  const [phase, setPhase] = useState<ReplyPhase>('idle');
  const [live, setLive] = useState('');
  const [problem, setProblem] = useState<ReplyProblem | null>(null);
  const run = useRef<ReplyRun | null>(null);
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  const supported = useMemo(() => engine.supported(), [engine]);
  const off = replyGate({ online: input.online, turnsUsed: input.turnsUsed, supported });

  const drop = useCallback((): void => {
    const current = run.current;
    run.current = null;
    current?.cancel();
  }, []);

  const start = useCallback((): void => {
    if (run.current) return;
    const gate = replyGate({
      online: latest.current.online,
      turnsUsed: latest.current.turnsUsed,
      supported: engine.supported(),
    });
    if (gate) return;
    setProblem(null);
    setLive('');
    setPhase('listening');
    const mine: ReplyRun = engine.start(
      { groupId: latest.current.groupId, locale: latest.current.locale },
      {
        onText: (text) => {
          if (run.current === mine) setLive(text);
        },
        onCaptured: () => {
          if (run.current === mine) setPhase('transcribing');
        },
        onEnd: (outcome) => {
          if (run.current !== mine) return;
          run.current = null;
          setPhase('idle');
          setLive('');
          if (outcome.kind === 'text') latest.current.onTranscript(outcome.text);
          else setProblem(outcome.kind === 'empty' ? 'empty' : outcome.kind);
        },
      },
    );
    run.current = mine;
  }, [engine]);

  const stop = useCallback((): void => {
    run.current?.stop();
  }, []);

  const cancel = useCallback((): void => {
    drop();
    setProblem(null);
    setPhase('idle');
    setLive('');
  }, [drop]);

  // Going offline mid-clip ends it; the card closing (unmount) frees the mic.
  useEffect(() => {
    if (!input.online && run.current) cancel();
  }, [input.online, cancel]);
  useEffect(() => drop, [drop]);

  return { phase, live, problem, off, start, stop, cancel };
}
