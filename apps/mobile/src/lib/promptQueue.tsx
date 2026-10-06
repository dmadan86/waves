/**
 * A priority queue for the one-at-a-time prompts that fight over the first-run
 * screen — the coach-mark tour and the daily tip sheet today, more later.
 *
 * The problem it solves: on the very first Home open both the tour and the tip
 * sheet want the screen at once, and stacking a hint on top of a coach-mark is
 * noise. So each overlay claims a slot with a priority while it wants to show,
 * and only the highest-priority live claim is *granted*. When that one releases
 * (the tour finishes), the next in line is granted — after its own delay, so a
 * hint lands a beat after the tour clears rather than the same frame.
 *
 * Kept deliberately small: a claim is just an id and a number, the winner is the
 * live claim with the largest number, and a slot's `granted` is "am I the winner
 * (once my delay has passed)". No timers or ordering live in the provider; the
 * delay is the waiting slot's own concern.
 *
 * Two rules keep it from feeling like a barrage:
 *
 * - **A prompt on screen keeps it.** Once a slot is granted it holds the screen
 *   until it releases, even if a higher claim turns up meanwhile (a check that
 *   finished late). Pulling a popup out from under somebody and putting it back
 *   after the other one reads as the same popup opening twice.
 * - **One per launch.** After a prompt has been shown and dismissed, the rest
 *   wait for the next launch. An `essential` claim — one that cannot be put off,
 *   like the required phone ask — is the only exception. The tour is not a
 *   popup and never holds, so the first prompt can still follow it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface PromptQueueValue {
  /** Register or update a claim; higher priority wins the screen. */
  claim: (id: string, priority: number, essential?: boolean) => void;
  /** Drop a claim — the next-highest live claim becomes the winner. */
  release: (id: string) => void;
  /** A granted slot is now on screen: it keeps the screen until it releases. */
  hold: (id: string) => void;
  /** The id of the live claim with the highest priority, or `null` if none. */
  winnerId: string | null;
}

const PromptQueueContext = createContext<PromptQueueValue | null>(null);

interface Claim {
  readonly priority: number;
  readonly essential: boolean;
}

interface QueueState {
  readonly claims: Readonly<Record<string, Claim>>;
  /** The slot on screen right now, if any. */
  readonly holder: string | null;
  /** A prompt has been shown and dismissed this launch. */
  readonly spent: boolean;
}

export function PromptQueueProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<QueueState>({ claims: {}, holder: null, spent: false });

  const claim = useCallback((id: string, priority: number, essential = false) => {
    setState((prev) => {
      const current = prev.claims[id];
      if (current && current.priority === priority && current.essential === essential) return prev;
      return { ...prev, claims: { ...prev.claims, [id]: { priority, essential } } };
    });
  }, []);

  const release = useCallback((id: string) => {
    setState((prev) => {
      if (!(id in prev.claims)) return prev;
      const claims = { ...prev.claims };
      delete claims[id];
      const wasHolder = prev.holder === id;
      return {
        claims,
        holder: wasHolder ? null : prev.holder,
        spent: prev.spent || wasHolder,
      };
    });
  }, []);

  const hold = useCallback((id: string) => {
    setState((prev) =>
      prev.holder === id || !(id in prev.claims) ? prev : { ...prev, holder: id },
    );
  }, []);

  // The prompt on screen keeps it. Otherwise the highest-priority live claim —
  // only essential ones once a prompt has had its turn this launch. `>` keeps
  // the first-inserted on a tie, but priorities are meant to be distinct.
  const winnerId = useMemo(() => {
    const { claims, holder, spent } = state;
    if (holder && holder in claims) return holder;
    let best: string | null = null;
    let bestPriority = -Infinity;
    for (const [id, { priority, essential }] of Object.entries(claims)) {
      if (spent && !essential) continue;
      if (priority > bestPriority) {
        bestPriority = priority;
        best = id;
      }
    }
    return best;
  }, [state]);

  const value = useMemo<PromptQueueValue>(
    () => ({ claim, release, hold, winnerId }),
    [claim, release, hold, winnerId],
  );

  return <PromptQueueContext.Provider value={value}>{children}</PromptQueueContext.Provider>;
}

/**
 * Whether the screen is currently free of one-at-a-time prompts.
 *
 * Read-only participation in the queue, for a surface that is not a popup and
 * therefore should not *claim* a slot: the status banner sits at the top of
 * whatever screen is showing and would happily coexist with most things, but
 * stacking it over the tip sheet or the push ask is noise. So it stands aside
 * while somebody else has the screen and comes back when they release it.
 *
 * Deliberately not a claim. A banner can be live for the three hours of a
 * maintenance window, and a claim held that long would starve every prompt
 * below it — the guest prompt and the daily tip would simply stop appearing,
 * which is not a trade anybody asked for.
 *
 * Outside a provider it answers "clear": a surface rendered in a tree with no
 * queue has nothing to wait for.
 */
export function usePromptQueueClear(): boolean {
  const ctx = useContext(PromptQueueContext);
  return ctx ? ctx.winnerId === null : true;
}

/**
 * Claim a slot in the prompt queue while `active`, and learn whether this slot
 * is cleared to show right now.
 *
 * `granted` is true only when this slot is the queue's winner *and* its
 * `delayMs` has elapsed since it became the winner. A higher-priority claim
 * appearing while it waits pulls `granted` back to false and cancels the wait,
 * so a tip that was a beat from showing steps aside the instant the tour starts.
 * Once granted it holds the screen until it goes inactive or unmounts.
 *
 * `essential` is for a prompt that cannot be put off (the required phone ask):
 * it still shows after another prompt has had this launch's turn.
 */
export function usePromptSlot({
  id,
  priority,
  active,
  delayMs = 0,
  essential = false,
}: {
  id: string;
  priority: number;
  active: boolean;
  delayMs?: number;
  essential?: boolean;
}): boolean {
  const ctx = useContext(PromptQueueContext);
  if (!ctx) throw new Error('usePromptSlot must be used within a PromptQueueProvider');
  const { claim, release, hold, winnerId } = ctx;

  useEffect(() => {
    if (active) claim(id, priority, essential);
    else release(id);
    return () => release(id);
  }, [id, priority, active, essential, claim, release]);

  const isWinner = active && winnerId === id;
  const [granted, setGranted] = useState(false);

  // Grant from the timer callback and revoke in the cleanup, never in the effect
  // body: a synchronous setState there cascades renders (and trips the lint). A
  // zero delay still routes through the timer, one tick later — cheap and lets
  // the two paths share one shape. Losing the winner (or a delay change) runs
  // the cleanup, which clears any pending grant and pulls `granted` back down, so
  // a higher-priority claim taking over stands this slot straight back down.
  useEffect(() => {
    if (!isWinner) return undefined;
    const timer = setTimeout(() => setGranted(true), Math.max(0, delayMs));
    return () => {
      clearTimeout(timer);
      setGranted(false);
    };
  }, [isWinner, delayMs]);

  useEffect(() => {
    if (granted) hold(id);
  }, [granted, hold, id]);

  return granted;
}
