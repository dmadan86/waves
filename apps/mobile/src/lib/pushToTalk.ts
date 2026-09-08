/**
 * Hold the raised mic and talk — the WhatsApp voice-note gesture, for expenses.
 *
 * The finger and the microphone are on two different screens. The button lives
 * in the root bottom bar (`AppTabBar`); the recogniser lives on the `voice`
 * route, which that button pushes. Nothing is passed between them by props and
 * nothing can be: the press happens before the screen exists, and the release
 * happens after it does. So the gesture is state, kept here, in one small store
 * both sides can see.
 *
 * **Why the capture starts on press-in rather than on a long-press timer.** The
 * obvious wiring is `onLongPress`, and it is wrong: React Native's default
 * long-press delay is half a second, and half a second is a whole word. By the
 * time the timer fired the speaker would already have said "add" and the
 * recogniser would open on the middle of the sentence. The finger landing is
 * the signal. If it lifts again inside {@link MIN_HOLD_MS} nothing was a hold at
 * all — it was a tap, and a tap already does the right thing (the screen opens
 * and keeps listening), so the release is simply not reported.
 *
 * The end of a hold is kept as a *pending* fact rather than an event, because
 * the screen that has to act on it may not have finished mounting when the
 * finger lifts. It is consumed once, by whoever gets there first.
 */

/**
 * Below this, a press is a tap and not a hold.
 *
 * Two things want the same number. A hold that ends this quickly cannot have
 * carried any speech, so ending the utterance on it would cut the speaker off
 * before they began; and the mic is still opening during roughly this window
 * (there is a permission call and an installed-model probe to await), so a
 * "finish now" that early has nothing to finish. Both say: treat it as the tap
 * it looks like and let the screen listen the way it always has.
 */
export const MIN_HOLD_MS = 250;

/** How a hold ended, once it is over. */
export type PushToTalkEnd = 'send' | 'cancel';

/** What a release turned out to be. */
export type PushToTalkRelease = PushToTalkEnd | 'tap';

export interface PushToTalkState {
  /** True while a finger is down on the raised mic. */
  readonly holding: boolean;
  /**
   * A hold that has ended and whose ending nobody has acted on yet — `send` to
   * finish the utterance, `cancel` to drop it. `seq` only ever grows, so a
   * consumer can tell two endings apart.
   */
  readonly ended: { readonly seq: number; readonly mode: PushToTalkEnd } | null;
}

const IDLE: PushToTalkState = { holding: false, ended: null };

/**
 * The gesture, as a store.
 *
 * Deliberately free of React and of the navigation stack so the rules can be
 * tested without a device — the button and the screen are both injected, in the
 * sense that neither is named here.
 */
export class PushToTalk {
  private state: PushToTalkState = IDLE;
  private listeners = new Set<() => void>();
  private startedAt = 0;
  private seq = 0;

  /** Subscribe to changes — the shape `useSyncExternalStore` wants. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The current gesture, as one immutable object. */
  getSnapshot = (): PushToTalkState => this.state;

  /** The finger has landed on the mic. */
  begin(now: number = Date.now()): void {
    this.startedAt = now;
    // A new hold supersedes an ending nobody got round to: the capture it
    // belonged to is over, and applying it to this one would end it on arrival.
    this.set({ holding: true, ended: null });
  }

  /**
   * The finger has lifted. Returns what the press turned out to be: `send` when
   * it was a real hold (the utterance should be finished now), or `tap` when it
   * was too brief to be one, in which case nothing is reported to the screen and
   * the mic goes on listening exactly as a tap leaves it.
   */
  release(now: number = Date.now()): PushToTalkRelease {
    if (!this.state.holding) return 'tap';
    const held = now - this.startedAt;
    if (held < MIN_HOLD_MS) {
      this.set({ holding: false, ended: null });
      return 'tap';
    }
    this.set({ holding: false, ended: { seq: ++this.seq, mode: 'send' } });
    return 'send';
  }

  /**
   * The finger slid clear of the button — WhatsApp's escape from a hold started
   * by accident. Unlike a release this counts however brief it was: a deliberate
   * "no, not this" must always be obeyed.
   */
  cancel(): PushToTalkEnd | null {
    if (!this.state.holding) return null;
    this.set({ holding: false, ended: { seq: ++this.seq, mode: 'cancel' } });
    return 'cancel';
  }

  /**
   * Take the pending ending, if there is one — it is delivered once.
   *
   * A fact rather than an event on purpose: the voice screen is pushed by the
   * same press that starts the hold, so a short-but-real hold can be over before
   * that screen has mounted and subscribed. Leaving the ending on the store lets
   * it be picked up on arrival instead of being missed.
   */
  take(): { seq: number; mode: PushToTalkEnd } | null {
    const ended = this.state.ended;
    if (!ended) return null;
    this.set({ ...this.state, ended: null });
    return { ...ended };
  }

  /** Forget everything — for tests, and for a sign-out that unmounts the bar. */
  reset(): void {
    this.startedAt = 0;
    this.set(IDLE);
  }

  private set(next: PushToTalkState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The app's one push-to-talk gesture.
 *
 * A module singleton because the thing it stands for is one thing: there is a
 * single raised mic and a single finger on it, whatever is on screen.
 */
export const pushToTalk = new PushToTalk();
