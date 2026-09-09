/**
 * One tap, one action.
 *
 * A finger that lands twice in a tenth of a second is one press as far as the
 * person is concerned, but two as far as React Native is concerned — and a
 * handler that pushes a screen runs twice, so the same screen is stacked twice
 * and takes two backs to leave. That is the bug this file exists for: it was
 * reported on the group header (open settings) but it was never those screens'
 * fault, it is what every navigating control in the app does.
 *
 * The gate below is the whole idea: after a control acts, it is deaf for a
 * short window. Deliberately *not* a "the app is busy" flag — each gate belongs
 * to one control, so pressing Save and then Cancel still does both things. And
 * deliberately not a disabled state: nothing re-renders, so a screen reader is
 * never told a live button is disabled, and the button never flickers.
 *
 * Pure on purpose — no React, no react-native — so it is unit-testable and so
 * the navigation guard in the app can share the same window.
 */

/**
 * How long a control stays deaf after acting.
 *
 * Long enough to swallow the accidental second half of a double tap (people
 * produce those at roughly 100–300ms apart, and an anxious "did that work?"
 * re-tap lands around half a second later); short enough that a deliberate
 * second press — reading the result, then pressing again — is never eaten.
 */
export const SINGLE_ACTION_WINDOW_MS = 600;

/**
 * The most a promise may hold a control shut, as a multiple of the window.
 *
 * Waiting on the handler is right — a save that takes two seconds must not be
 * fired twice — but "wait for the promise" with no ceiling means one promise
 * that never settles kills the button for the life of the screen, and there is
 * no way for the person holding the phone to tell that from a frozen app. A
 * promise that has not come back in twelve seconds is not going to; the control
 * answers again, and whatever the handler eventually does is its own business.
 */
const LOCK_CEILING_MULTIPLE = 20;

/** The ceiling in milliseconds, for the default window: twelve seconds. */
export const MAX_ACTION_LOCK_MS = SINGLE_ACTION_WINDOW_MS * LOCK_CEILING_MULTIPLE;

/** Reads the current time in milliseconds. Injected so tests need no timers. */
export type Clock = () => number;

export interface TapGateOptions {
  /** Deaf period after an action, in milliseconds. */
  windowMs?: number;
  /** Longest an unsettled promise may hold the gate. Defaults off `windowMs`. */
  ceilingMs?: number;
  now?: Clock;
}

export interface TapGate {
  /**
   * Runs `action` if the gate is open, and returns whether it ran.
   *
   * If the action *returns* a promise the gate stays shut until it settles (and
   * then for whatever is left of the window), so a slow save cannot be fired
   * twice and a fast one is still protected from the second tap. Note the word
   * returns: the app overwhelmingly writes `onPress={() => void save()}`, which
   * hands back `undefined` — those controls get the window and nothing more,
   * and lean on their own `busy` flag for the rest, which is the arrangement
   * this is meant to layer with rather than replace.
   */
  run: (action: () => unknown) => boolean;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function createTapGate(options: TapGateOptions = {}): TapGate {
  const windowMs = options.windowMs ?? SINGLE_ACTION_WINDOW_MS;
  const ceilingMs = options.ceilingMs ?? windowMs * LOCK_CEILING_MULTIPLE;
  const now = options.now ?? Date.now;

  /** The moment the gate opens again. */
  let openAt = Number.NEGATIVE_INFINITY;
  /** An async action is still in flight. */
  let running = false;
  /** When that in-flight action stops being allowed to hold the gate. */
  let runningUntil = 0;
  /**
   * Which run owns the lock. A promise that settles after the ceiling has
   * already handed the gate to a later press must not open it again underneath
   * that press — it is answering for a tap two taps ago.
   */
  let generation = 0;

  return {
    run(action) {
      const at = now();
      if (running && at < runningUntil) return false;
      if (at < openAt) return false;

      const mine = (generation += 1);
      const release = (): void => {
        if (generation === mine) running = false;
      };

      openAt = at + windowMs;
      running = true;
      runningUntil = at + ceilingMs;

      let result: unknown;
      try {
        result = action();
      } catch (error) {
        // A handler that threw has finished, however badly. Re-open on the
        // window rather than wedging the control shut forever.
        release();
        throw error;
      }

      if (isThenable(result)) {
        result.then(release, (error: unknown) => {
          release();
          // Re-raised on the derived promise, so a handler that rejects still
          // surfaces as an unhandled rejection exactly as it did before this
          // gate existed. Returning quietly here would be the gate deciding to
          // hide a failure, which is not its job.
          throw error;
        });
      } else {
        release();
      }

      return true;
    },
  };
}

/**
 * Which handler a control should actually attach: the guarded one, the raw one,
 * or nothing at all.
 *
 * Split out of the hook so the two rules that matter can be stated without a
 * renderer — a control with no handler stays handler-less (call sites test
 * `onPress` to decide whether to wrap the content in a `Pressable` at all), and
 * a `repeatable` control is handed its own handler straight back, so no gate is
 * ever consulted for it.
 */
export function selectPressHandler<A extends unknown[]>(
  handler: ((...args: A) => unknown) | null | undefined,
  guarded: (...args: A) => void,
  repeatable: boolean,
): ((...args: A) => void) | undefined {
  if (handler == null) return undefined;
  return repeatable ? handler : guarded;
}
