/**
 * The Speak-an-expense screen as one state machine, kept pure so every
 * transition can be tested without a phone.
 *
 *   IDLE → LISTENING → PROCESSING → PREVIEW → SAVING → SUCCESS
 *   plus PERMISSION_REQUIRED, ERROR, NO_SPEECH and CLARIFICATION_REQUIRED.
 *
 * Two layers, and neither is a parallel copy of the screen:
 *
 *  - {@link captureReducer} IS the microphone panel's state. `VoiceCapture`
 *    keeps nothing else about the mic: whether it is starting or open, the words
 *    heard so far, and why it stopped (no speech, a refused permission, an
 *    error) all live here.
 *  - {@link voiceFlowState} reads the screen's existing `phase` (listening,
 *    thinking, review, committing, answer, agent) together with the capture state
 *    and the save flags, and names the one state the person is in. The status
 *    line, the announcement and which card shows are all derived from it.
 *
 * {@link singleFlight} is the "no double save, no duplicate parse" guard: a
 * second call while the first is running is refused, synchronously, before any
 * re-render could disable a button.
 */

export type VoiceFlowState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'preview'
  | 'saving'
  | 'success'
  | 'permission_required'
  | 'error'
  | 'no_speech'
  | 'clarification_required';

/** Why a capture stopped without words, when it did. */
export type CaptureProblem =
  | { readonly kind: 'no-speech' }
  | { readonly kind: 'permission'; readonly message: string; readonly settings: boolean }
  | { readonly kind: 'error'; readonly message: string };

export interface CaptureState {
  /** `starting`: asked to open, audio not yet flowing. `listening`: audio is being heard. */
  readonly mic: 'idle' | 'starting' | 'listening';
  /** The words heard so far (partial while listening, final once it stops). */
  readonly transcript: string;
  /** The transcript is the recogniser's last word, not a partial. */
  readonly final: boolean;
  readonly problem: CaptureProblem | null;
}

export type CaptureEvent =
  /** A tap, a hold, a retry or the auto-start asked the mic to open. */
  | { readonly type: 'start' }
  /** Audio is being captured — the recogniser or the stream is live. */
  | { readonly type: 'opened' }
  /** Words so far. */
  | { readonly type: 'partial'; readonly text: string }
  /** The sentence finished with words. */
  | { readonly type: 'final'; readonly text: string }
  /** The sentence finished with no words at all. */
  | { readonly type: 'noSpeech' }
  | {
      readonly type: 'error';
      readonly message: string;
      /** A refused microphone permission rather than a failure. */
      readonly permission?: boolean;
      /** Only Settings can fix it (the system will not ask again). */
      readonly settings?: boolean;
    }
  /** The start sequence is over (opened or not). */
  | { readonly type: 'settled' }
  /** The mic closed; whatever was heard is kept. */
  | { readonly type: 'closed' }
  /** Dropped: back to rest with nothing kept (a push-to-talk cancel). */
  | { readonly type: 'cancel' };

export const CAPTURE_IDLE: CaptureState = {
  mic: 'idle',
  transcript: '',
  final: false,
  problem: null,
};

/** The capture panel's start state: `starting` when it opens the mic by itself. */
export function initialCapture(autoStart: boolean): CaptureState {
  return autoStart ? { ...CAPTURE_IDLE, mic: 'starting' } : CAPTURE_IDLE;
}

export function captureReducer(state: CaptureState, event: CaptureEvent): CaptureState {
  switch (event.type) {
    case 'start':
      // Speaking again is the retry: every miss and error clears as the mic opens.
      return { mic: 'starting', transcript: '', final: false, problem: null };
    case 'opened':
      return state.mic === 'listening' ? state : { ...state, mic: 'listening' };
    case 'partial':
      // Identical text is no change at all, so a recogniser repeating itself
      // (Deepgram re-sends the finished sentence while the room is quiet) costs
      // no render.
      if (state.transcript === event.text && !state.final) return state;
      return { ...state, transcript: event.text, final: false };
    case 'final':
      return { mic: 'idle', transcript: event.text, final: true, problem: null };
    case 'noSpeech':
      // The recogniser reports a failure with `error` and then ends with no
      // words; that empty end must not overwrite the reason (and its Open
      // settings / Try again) with a vaguer "couldn't hear".
      if (state.problem && state.problem.kind !== 'no-speech')
        return { ...state, mic: 'idle', transcript: '', final: false };
      return { mic: 'idle', transcript: '', final: false, problem: { kind: 'no-speech' } };
    case 'error':
      return {
        ...state,
        mic: 'idle',
        problem: event.permission
          ? { kind: 'permission', message: event.message, settings: event.settings === true }
          : { kind: 'error', message: event.message },
      };
    case 'settled':
      return state.mic === 'starting' ? { ...state, mic: 'idle' } : state;
    case 'closed':
      return state.mic === 'idle' ? state : { ...state, mic: 'idle' };
    case 'cancel':
      return CAPTURE_IDLE;
  }
}

/** The screen's own phases, as `voice.tsx` names them. */
export type VoicePhase =
  | 'listening'
  | 'thinking'
  | 'review'
  | 'committing'
  | 'answer'
  | 'agent'
  /** Saved, and still on the voice screen: the success state. */
  | 'saved';

/**
 * Where the Pro agent's panel is, as it reports it to the screen: reading the
 * sentence, a proposal ready to confirm, a question it needs answered, or the
 * expense saved. It lets the stage above the panel say the same thing the panel
 * is doing without the screen reaching into it.
 */
export type AgentStage = 'working' | 'ready' | 'question' | 'saved';

export interface VoiceFlowInput {
  readonly phase: VoicePhase;
  /** The mic panel's state while it is on screen (the listening phase). */
  readonly capture?: CaptureState | null;
  /** The last sentence was heard but carried no amount (parsed by the screen). */
  readonly missed?: boolean;
  /** A save is running. */
  readonly saving?: boolean;
  /** A save finished and the screen is leaving. */
  readonly saved?: boolean;
  /** The preview has a question that must be answered before it can be saved:
   *  an amount read two ways, a currency, a group or a person not yet matched. */
  readonly needsAnswer?: boolean;
  /** The agent panel's stage while `phase` is `agent` (absent: still reading). */
  readonly agent?: AgentStage;
  /** An answer is still being worked out (the mic is busy, never a second spinner). */
  readonly answering?: boolean;
}

export function voiceFlowState(input: VoiceFlowInput): VoiceFlowState {
  if (input.saved) return 'success';
  switch (input.phase) {
    case 'saved':
      return 'success';
    case 'thinking':
      return 'processing';
    case 'agent':
      if (input.agent === 'saved') return 'success';
      if (input.agent === 'question') return 'clarification_required';
      return input.agent === 'ready' ? 'preview' : 'processing';
    case 'committing':
      return 'saving';
    case 'answer':
      return input.answering ? 'processing' : 'preview';
    case 'review':
      if (input.saving) return 'saving';
      return input.needsAnswer ? 'clarification_required' : 'preview';
    case 'listening': {
      const capture = input.capture ?? CAPTURE_IDLE;
      if (capture.mic !== 'idle') return 'listening';
      if (capture.problem?.kind === 'permission') return 'permission_required';
      if (capture.problem?.kind === 'error') return 'error';
      if (capture.problem?.kind === 'no-speech' || input.missed) return 'no_speech';
      // Words with the mic shut are on their way to the parser (or, for a
      // stream, still being flushed): that is understanding, not a reset.
      if (capture.transcript.trim()) return 'processing';
      return 'idle';
    }
  }
}

/** Which line the status under the mic says. */
export type VoiceStatusKey =
  | 'ready'
  | 'starting'
  | 'listening'
  | 'processing'
  | 'noSpeech'
  | 'noAmount'
  | 'permission'
  | 'error'
  | 'expenseReady'
  | 'check'
  | 'saving'
  | 'saved';

export function voiceStatusKey(state: VoiceFlowState, input: VoiceFlowInput): VoiceStatusKey {
  switch (state) {
    case 'idle':
      return 'ready';
    case 'listening':
      return input.capture?.mic === 'starting' ? 'starting' : 'listening';
    case 'processing':
      return 'processing';
    case 'no_speech':
      // Words were heard but no amount among them: say that, not "couldn't hear".
      return input.missed && input.capture?.problem?.kind !== 'no-speech' ? 'noAmount' : 'noSpeech';
    case 'permission_required':
      return 'permission';
    case 'error':
      return 'error';
    case 'preview':
      return 'expenseReady';
    case 'clarification_required':
      return 'check';
    case 'saving':
      return 'saving';
    case 'success':
      return 'saved';
  }
}

/** The status line is a live region; announce a change, never a repeat. */
export function statusAnnouncement(previous: string | null, next: string): string | null {
  return next && next !== previous ? next : null;
}

/** The mic button's job in a state: what its icon shows and whether it can be tapped. */
export function micButtonMode(state: VoiceFlowState): 'start' | 'stop' | 'busy' | 'retry' {
  if (state === 'listening') return 'stop';
  if (state === 'processing' || state === 'saving' || state === 'success') return 'busy';
  if (state === 'no_speech' || state === 'error' || state === 'permission_required') return 'retry';
  return 'start';
}

/**
 * The status line of the one stage that stays on screen after the sentence is
 * heard. Same as {@link voiceStatusKey}, except a read-only answer to a question
 * is not an "expense ready".
 */
export function stageStatusKey(input: VoiceFlowInput): VoiceStatusKey {
  if (input.phase === 'answer' && !input.saved && !input.answering) return 'ready';
  return voiceStatusKey(voiceFlowState(input), input);
}

/** What the stage's mic offers once the sentence has been read. A saved
 *  expense is not busy: the mic is the quick way to speak the next one. */
export function stageMicMode(state: VoiceFlowState): 'start' | 'stop' | 'busy' | 'retry' {
  return state === 'success' ? 'start' : micButtonMode(state);
}

/** What tapping the stage's mic does after the sentence is read: nothing while
 *  it works, add to a reviewed batch, or start over from a saved/agent card. */
export type StageMicTap = 'none' | 'append' | 'fresh';

export function stageMicTap(phase: VoicePhase, state: VoiceFlowState): StageMicTap {
  if (state === 'processing' || state === 'saving') return 'none';
  if (phase === 'review') return 'append';
  return 'fresh';
}

/** Suggestions fill the sheet until the first word is heard: before speaking and
 *  while the mic is open and silent. Words, a sentence being read or a preview
 *  replace them. */
export function showSuggestions(state: VoiceFlowState, transcript: string): boolean {
  if (transcript.trim()) return false;
  return state === 'idle' || state === 'no_speech' || state === 'listening';
}

/**
 * One job at a time. `run` refuses (returns false) while an earlier run is still
 * in flight, so a double tap on Add expense is one save, and the second of two
 * transcripts arriving together is not parsed twice.
 */
export function singleFlight(): {
  run: (job: () => Promise<void>) => Promise<boolean>;
  readonly busy: boolean;
} {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run(job) {
      if (busy) return false;
      busy = true;
      try {
        await job();
        return true;
      } finally {
        busy = false;
      }
    },
  };
}
