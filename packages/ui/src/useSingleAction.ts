import { useCallback, useEffect, useRef } from 'react';

import { createTapGate, selectPressHandler, type TapGate } from './press';

export interface SingleActionOptions {
  /**
   * Turns the guard off, for controls whose whole point is being pressed fast
   * and repeatedly: a quantity stepper, a number pad, a toggle, a tab, a row in
   * a multi-select. Those are not "one action twice", they are two actions.
   */
  repeatable?: boolean;
}

/**
 * Wraps a press handler so that a second tap inside
 * {@link import('./press').SINGLE_ACTION_WINDOW_MS} is swallowed.
 *
 * The gate lives in a ref, so it is per component instance — two different
 * buttons never block each other — and nothing here sets state, so guarding
 * costs no render and never lies to a screen reader about the control being
 * disabled. `undefined` in, `undefined` out, so `if (!onPress)` checks at the
 * call sites keep working.
 */
export function useSingleAction<A extends unknown[]>(
  handler: ((...args: A) => unknown) | null | undefined,
  options: SingleActionOptions = {},
): ((...args: A) => void) | undefined {
  const { repeatable = false } = options;

  // The gate calls whatever the handler is *now*, so a handler that closes over
  // fresh state is never called stale, and the guarded callback stays stable.
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  const gate = useRef<TapGate | null>(null);
  gate.current ??= createTapGate();

  const guarded = useCallback((...args: A) => {
    gate.current?.run(() => latest.current?.(...args));
  }, []);

  return selectPressHandler(handler, guarded, repeatable);
}
