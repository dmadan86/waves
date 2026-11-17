'use client';

import { useSyncExternalStore } from 'react';

/**
 * A statically prerendered page freezes `new Date().getFullYear()` at build
 * time, so the copyright silently goes stale the moment the year turns and
 * nothing forces a redeploy.
 *
 * The server renders the range up to the build year, so crawlers and no-JS
 * readers never see a stale lone start year. The reader's own clock then takes
 * over through `useSyncExternalStore` (hydration uses the server snapshot, then
 * re-renders), so a page built last year still shows this year.
 */
const subscribe = () => () => {};
const getYear = () => new Date().getFullYear();
const BUILD_YEAR = new Date().getFullYear();
const getServerYear = () => BUILD_YEAR;

export function CopyrightYears({ from }: { from: number }) {
  const now = useSyncExternalStore(subscribe, getYear, getServerYear);

  if (now <= from) return <>{from}</>;
  return <>{`${from}–${now}`}</>;
}
