/**
 * One tap, one action.
 *
 * Reported from a phone: the group header's settings button opened the settings
 * screen twice on a quick double tap, and it took two backs to get out. The
 * finger is faster than the navigator, so both taps are delivered and both are
 * honoured. What is pinned here is the gate that makes the second one a no-op —
 * and, just as importantly, the cases where it must NOT: a stepper, a keypad, a
 * toggle. Swallowing the second tap on those would be a worse bug than the one
 * being fixed, because it would be silent.
 */

import { describe, expect, it } from 'vitest';

import {
  createTapGate,
  MAX_ACTION_LOCK_MS,
  selectPressHandler,
  SINGLE_ACTION_WINDOW_MS,
} from '@waves/ui/press';

/** A clock the test drives by hand — no timers, no flakiness. */
function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let value = start;
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

describe('tap gate', () => {
  it('runs the first tap', () => {
    const gate = createTapGate({ now: clock().now });
    let runs = 0;
    expect(gate.run(() => (runs += 1))).toBe(true);
    expect(runs).toBe(1);
  });

  it('swallows a second tap inside the window', () => {
    const time = clock();
    const gate = createTapGate({ now: time.now });
    let runs = 0;
    const tap = (): boolean => gate.run(() => (runs += 1));

    expect(tap()).toBe(true);
    time.advance(120); // a real double tap
    expect(tap()).toBe(false);
    time.advance(300); // the anxious "did that work?" re-tap
    expect(tap()).toBe(false);
    expect(runs).toBe(1);
  });

  it('lets a tap through once the window has passed', () => {
    const time = clock();
    const gate = createTapGate({ now: time.now });
    let runs = 0;
    const tap = (): boolean => gate.run(() => (runs += 1));

    expect(tap()).toBe(true);
    time.advance(SINGLE_ACTION_WINDOW_MS);
    expect(tap()).toBe(true);
    expect(runs).toBe(2);
  });

  it('is per control — one gate never silences another', () => {
    const time = clock();
    const save = createTapGate({ now: time.now });
    const cancel = createTapGate({ now: time.now });
    let saved = 0;
    let cancelled = 0;

    expect(save.run(() => (saved += 1))).toBe(true);
    time.advance(50);
    // Pressing Save then Cancel is two different actions, not a double tap.
    expect(cancel.run(() => (cancelled += 1))).toBe(true);
    expect(saved).toBe(1);
    expect(cancelled).toBe(1);
  });

  it('makes a double-tapped back one pop, without slowing the way out of a stack', () => {
    // `useGoBack` puts one of these behind each header's chevron. That is why
    // `router.back()` itself is left unguarded: a guard on the router could not
    // tell "this header, twice" from "the header underneath, next" — and the
    // second is somebody leaving in a hurry, which must never be refused.
    const time = clock();
    const expenseHeader = createTapGate({ now: time.now });
    const groupHeader = createTapGate({ now: time.now });
    let pops = 0;
    const pop = (): number => (pops += 1);

    expect(expenseHeader.run(pop)).toBe(true);
    time.advance(130);
    expect(expenseHeader.run(pop)).toBe(false); // the second half of the double tap
    time.advance(90);
    expect(groupHeader.run(pop)).toBe(true); // the screen underneath, straight away
    expect(pops).toBe(2);
  });

  it('stays shut for the whole of a slow async handler', async () => {
    const time = clock();
    const gate = createTapGate({ now: time.now });
    let runs = 0;
    const pending: (() => void)[] = [];

    const tap = (): boolean =>
      gate.run(() => {
        runs += 1;
        return new Promise<void>((resolve) => {
          pending.push(resolve);
        });
      });

    expect(tap()).toBe(true);
    // Well past the window, but the save has not come back yet.
    time.advance(SINGLE_ACTION_WINDOW_MS * 10);
    expect(tap()).toBe(false);
    expect(runs).toBe(1);

    pending.shift()?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(tap()).toBe(true);
    expect(runs).toBe(2);
  });

  it('still honours the minimum window after a fast async handler', async () => {
    const time = clock();
    const gate = createTapGate({ now: time.now });
    let runs = 0;
    const tap = (): boolean =>
      gate.run(() => {
        runs += 1;
        return Promise.resolve();
      });

    expect(tap()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    // The promise has settled but the finger is still mid-double-tap.
    time.advance(100);
    expect(tap()).toBe(false);
    expect(runs).toBe(1);
  });

  it('gives up on a promise that never settles', async () => {
    // Otherwise one hung promise kills the control for the life of the screen,
    // and from the outside that is indistinguishable from a frozen app. The
    // real candidate is a handler awaiting `requestAnimationFrame`, which does
    // not fire while an Android app is backgrounded.
    const time = clock();
    const gate = createTapGate({ now: time.now });
    let runs = 0;
    const tap = (): boolean =>
      gate.run(() => {
        runs += 1;
        return new Promise<void>(() => {
          /* never settles */
        });
      });

    expect(tap()).toBe(true);
    time.advance(MAX_ACTION_LOCK_MS - 1);
    expect(tap()).toBe(false);
    time.advance(1);
    expect(tap()).toBe(true);
    expect(runs).toBe(2);
  });

  it('does not let a late promise unlock the press that replaced it', async () => {
    const time = clock();
    const gate = createTapGate({ now: time.now });
    const pending: (() => void)[] = [];
    const slow = (): boolean =>
      gate.run(
        () =>
          new Promise<void>((resolve) => {
            pending.push(resolve);
          }),
      );

    expect(slow()).toBe(true);
    time.advance(MAX_ACTION_LOCK_MS);
    expect(slow()).toBe(true); // the ceiling handed the gate to this press

    // The abandoned first promise finally comes back. It must not open the gate
    // under the press that is now holding it.
    pending.shift()?.();
    await Promise.resolve();
    await Promise.resolve();

    time.advance(SINGLE_ACTION_WINDOW_MS);
    expect(slow()).toBe(false);
  });

  it('re-opens after a handler that threw', () => {
    const time = clock();
    const gate = createTapGate({ now: time.now });

    expect(() =>
      gate.run(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    time.advance(SINGLE_ACTION_WINDOW_MS);
    // A control that threw once must not be dead for the rest of the session.
    expect(gate.run(() => undefined)).toBe(true);
  });
});

describe('which handler a control attaches', () => {
  const guarded = (): void => {};

  it('leaves a repeatable control unguarded', () => {
    // A stepper, a keypad digit, a toggle, a tab. Losing the second press on
    // one of those would be a worse bug than the one being fixed, so the gate
    // is not merely opened for them — it is never consulted.
    const bump = (): void => {};
    expect(selectPressHandler(bump, guarded, true)).toBe(bump);
  });

  it('guards everything else', () => {
    const open = (): void => {};
    expect(selectPressHandler(open, guarded, false)).toBe(guarded);
  });

  it('lets a row that is a switch answer on, then off', () => {
    // The group settings "favourite" row is its own trailing Switch: same
    // handler, same state. Guarded, the row refused a fast on-off that the
    // Switch beside it accepted, and the star disagreed with itself.
    const time = clock();
    const gate = createTapGate({ now: time.now });
    let favourite = false;
    const toggle = (): void => {
      favourite = !favourite;
    };

    const guardedRow = selectPressHandler(toggle, () => gate.run(toggle), false);
    guardedRow?.();
    time.advance(150);
    guardedRow?.();
    expect(favourite).toBe(true); // the off tap was eaten — the bug

    favourite = false;
    const repeatableRow = selectPressHandler(toggle, () => gate.run(toggle), true);
    repeatableRow?.();
    time.advance(150);
    repeatableRow?.();
    expect(favourite).toBe(false); // on, then off, as pressed
  });

  it('keeps a handler-less control handler-less', () => {
    // `ListRow` and `Avatar` both test `onPress` to decide whether to wrap
    // their content in a `Pressable` at all; handing them a stub would make
    // every static row announce itself as a button.
    expect(selectPressHandler(undefined, guarded, false)).toBeUndefined();
    expect(selectPressHandler(null, guarded, false)).toBeUndefined();
  });
});
