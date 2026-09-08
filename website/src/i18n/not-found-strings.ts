import ar from './dictionaries/ar.json';
import en from './dictionaries/en.json';
import hi from './dictionaries/hi.json';
import ta from './dictionaries/ta.json';
import type { Locale } from './config';

/**
 * The twelve strings the 404 page needs, in all four languages.
 *
 * `not-found.tsx` cannot read route params, and reading the path from
 * `headers()` on the server would make the whole locale segment dynamic — the
 * marketing pages would stop being prerendered to pay for one error page. So
 * the strings travel to the client instead, where the locale comes from the
 * pathname, and every page stays static. It is twelve short strings; the full
 * dictionaries never reach the browser.
 */
export const notFoundStrings: Record<Locale, { title: string; body: string; back: string }> = {
  en: en.notFound,
  ta: ta.notFound,
  hi: hi.notFound,
  ar: ar.notFound,
};
