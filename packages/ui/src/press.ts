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

/** Reads the current time in milliseconds. Injected so tests need no timers. */
export type Clock = () => number;

export interface TapGateOptions {
  /** Deaf period after an action, in milliseconds. */
  windowMs?: number;
  now?: Clock;
}

export interface TapGate {
  /**
   * Runs `action` if the gate is open, and returns whether it ran.
   *
   * If the action returns a promise the gate stays shut until it settles, and
   * then for whatever is left of the window — a slow save cannot be fired
   * twice, and a fast one is still protected from the second tap.
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
  const now = options.now ?? Date.now;

  /** The moment the gate opens again. */
  let openAt = Number.NEGATIVE_INFINITY;
  /** An async action is still in flight. */
  let running = false;

  return {
    run(action) {
      if (running || now() < openAt) return false;

      openAt = now() + windowMs;
      running = true;

      let result: unknown;
      try {
        result = action();
      } catch (error) {
        // A handler that threw has finished, however badly. Re-open on the
        // window rather than wedging the control shut forever.
        running = false;
        throw error;
      }

      if (isThenable(result)) {
        result.then(
          () => {
            running = false;
          },
          (error: unknown) => {
            running = false;
            // Re-raise: swallowing it here would hide a failing handler that
            // the app would otherwise have reported.
            throw error;
          },
        );
      } else {
        running = false;
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
