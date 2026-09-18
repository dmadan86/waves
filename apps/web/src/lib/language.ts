/**
 * Choosing the language, and remembering the choice.
 *
 * The language is decided on the **server**, which is what lets `<html lang>`
 * and `dir` be right in the first paint rather than corrected a frame later —
 * somebody arriving on an Arabic phone should not watch the page turn around.
 * That is why the choice lives in a cookie: the server can read it, and
 * `localStorage` (where the theme lives) it cannot.
 *
 * So there are three places a language can come from, in this order:
 *
 *   1. **The cookie** — somebody said so, on this browser.
 *   2. **`Accept-Language`** — what the browser asked for.
 *   3. **English**, when neither offers a language this app speaks.
 *
 * The profile carries it too, so the phone agrees and the emails somebody gets
 * are in the same language as their screen. It does NOT yet flow the other way:
 * a choice made here is not adopted by a *different* browser, because reading
 * the profile before the first paint would mean a fetch on every page load for
 * a preference the cookie already answers. Worth doing; not done here.
 *
 * Changing the language reloads the page. That is not laziness: the direction
 * of the whole document is settled server-side, and switching to Arabic without
 * a reload would leave an LTR skeleton around RTL text. The phone has the same
 * constraint for the same reason.
 */

import { Language, LANGUAGES, pickLanguage } from '@/i18n';

/** The cookie the server reads before it reads the browser's own preference. */
export const LANGUAGE_COOKIE = 'waves.lang';

/** A year. A language choice is not a session-length opinion. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Whether a string is one of the four languages this app speaks. */
export function isLanguage(value: string | null | undefined): value is Language {
  return !!value && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * The language to render in, given what was remembered and what was asked for.
 *
 * A cookie carrying something this app does not speak is ignored rather than
 * trusted — it is client-supplied text, and the alternative to ignoring it is
 * rendering a page in nothing at all.
 */
export function chooseLanguage(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Language {
  if (isLanguage(cookie)) return cookie;
  return pickLanguage(acceptLanguage);
}

/** Remember a choice on this browser, where the server can read it. */
export function rememberLanguage(language: Language): void {
  // `SameSite=Lax` because this is a preference, not a credential, and it has
  // to survive somebody following a link into the app from elsewhere.
  document.cookie = `${LANGUAGE_COOKIE}=${language}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

/** What this browser currently remembers, if anything. */
export function rememberedLanguage(cookieHeader: string): Language | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== LANGUAGE_COOKIE) continue;
    const value = rest.join('=');
    return isLanguage(value) ? value : null;
  }
  return null;
}
