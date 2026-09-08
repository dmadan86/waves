'use client';

import { useSyncExternalStore } from 'react';

import { AXIS, type ChartInk } from './palette';

/**
 * Which theme the charts should draw their *chrome* in.
 *
 * The rest of the console gets this for free — `prefers-color-scheme` swaps
 * the CSS custom properties and every border follows. ECharts cannot: it
 * writes computed colours into an SVG tree it owns, so an axis label picked
 * once at render stays that colour when the OS flips at sunset.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, because that is
 * precisely the shape of the problem: the media query is an external store,
 * this subscribes to it, and the third argument is the answer to give while
 * rendering on the server, where `matchMedia` does not exist. Doing it the
 * other way — setting state inside an effect — renders once with the wrong
 * value and then immediately again, which React 19's lint rule quite rightly
 * refuses.
 */

const QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;

/**
 * The server has no media query, so it draws the light chrome — and so does
 * the client's first paint, which is what keeps the two in agreement. A dark
 * reader gets one frame of light axis labels before the store corrects it;
 * the alternative is a hydration mismatch on every chart.
 */
const getServerSnapshot = () => false;

export function useChartInk(): ChartInk {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return dark ? AXIS.dark : AXIS.light;
}
