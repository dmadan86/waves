/**
 * The hook side of `./store` — split into its own file so that module stays
 * framework-free (see the comment at its top) while this one is free to pull
 * in `@/sync`.
 */

import { useEffect, useState } from 'react';

import { useSync } from '@/sync';

import { demoStateSync, ensureDemoDecision, subscribeDemoState } from './store';

/**
 * Is the demo group active for this account, right now?
 *
 * `isNewAccount` only matters the first time this account is ever asked —
 * pass the honest answer (real groups are empty) each time regardless; it is
 * ignored once a decision exists. Nothing is decided before the local mirror
 * has hydrated (`hydrated` from `useSync()`): a transient "zero groups" on
 * the very first frame of a *returning* account, before its own groups have
 * loaded off disk, must never be mistaken for a brand-new one.
 */
export function useDemoActive(ownerId: string | null, isNewAccount: boolean): boolean {
  const { hydrated } = useSync();
  const [, forceRender] = useState(0);

  useEffect(() => subscribeDemoState(() => forceRender((n) => n + 1)), []);

  useEffect(() => {
    if (!ownerId || !hydrated) return;
    void ensureDemoDecision(ownerId, isNewAccount);
    // `isNewAccount` deliberately excluded: re-running this effect every time
    // the real group count changes would re-ask a question that is only ever
    // answered once. The cache (and the early return above) makes repeat
    // calls free regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, hydrated]);

  if (!ownerId) return false;
  return demoStateSync(ownerId) === 'active';
}

/** Whether this account's demo decision is still loading — available for a
 *  screen that wants to hold a demo-only row out until there is an answer
 *  either way, rather than flashing it in. */
export function useDemoKnown(ownerId: string | null): boolean {
  const [, forceRender] = useState(0);
  useEffect(() => subscribeDemoState(() => forceRender((n) => n + 1)), []);
  if (!ownerId) return false;
  return demoStateSync(ownerId) !== null;
}
