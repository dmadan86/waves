'use client';

import { useSyncExternalStore } from 'react';

/**
 * A statically prerendered page freezes `new Date().getFullYear()` at build
 * time, so the copyright silently goes stale the moment the year turns and
 * nothing forces a redeploy.
 *
 * The start year is a constant and renders on the server. The end year is read
 * from the reader's own clock — the only clock that is actually right — through
 * `useSyncExternalStore`, whose server snapshot is `null`, so the markup the
 * server sends and the markup the client hydrates never disagree.
 */
const subscribe = () => () => {};
const getYear = () => new Date().getFullYear();
const getServerYear = () => null;

export function CopyrightYears({ from }: { from: number }) {
  const now = useSyncExternalStore(subscribe, getYear, getServerYear);

  if (now === null || now <= from) return <>{from}</>;
  return <>{`${from}–${now}`}</>;
}
