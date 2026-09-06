/**
 * Backend errors, said out loud in a way somebody can act on.
 *
 * The mobile app learned this in #256 and the web client never did: every
 * `catch` here ended in `caught instanceof Error ? caught.message : String(caught)`
 * rendered straight into the page. PostgREST and GoTrue write their messages
 * for whoever wrote the query, so a guest following an invite link could be
 * shown
 *
 *   new row violates row-level security policy for table "expenses"
 *
 * which is frightening, untranslated, and tells them nothing they can do. Worse
 * on the web than on mobile: this is the app for somebody who installed
 * nothing, and a page that talks about policies and schema caches is a tab they
 * close.
 *
 * The original is not thrown away — it goes to Sentry, where a sentence naming
 * a table is exactly what is wanted. This mirrors `apps/mobile/src/lib/errors.ts`
 * deliberately; the two are separate files because that one imports from the
 * React Native app's module graph, and the shared half is the doctrine, not the
 * code.
 */

import * as Sentry from '@sentry/nextjs';

/** The shape supabase-js hands back on a failed rpc or auth call. */
interface Postgrestish {
  message?: string;
  code?: string;
  /** supabase-js AuthError carries the HTTP status — 429 on a rate limit. */
  status?: number;
}

export interface ErrorWords {
  /** What to say when nothing more specific fits. */
  fallback: string;
  /** The connection is the problem, not what they did. */
  offline?: string;
  /** They went too fast, and the request itself was fine. */
  tooMany?: string;
}

/**
 * A sentence for the page, and the real error for us.
 *
 * `where` tags the Sentry event so a spike is traceable to one screen.
 */
export function friendlyError(caught: unknown, where: string, words: ErrorWords): string {
  const error = (caught ?? {}) as Postgrestish;
  const message =
    typeof error.message === 'string' ? error.message : typeof caught === 'string' ? caught : '';

  Sentry.captureException(caught, { tags: { where } });

  // Too many requests in too short a window — the sign-in buttons hit
  // Supabase's send-rate limit if tapped repeatedly. "Could not sign in" reads
  // as a rejected credential, which is wrong: the request was fine, there were
  // just too many of them.
  if (
    error.status === 429 ||
    /rate limit|too many requests|over_.*_rate_limit/i.test(message) ||
    /rate.?limit/i.test(typeof error.code === 'string' ? error.code : '')
  ) {
    return words.tooMany ?? words.fallback;
  }

  // A dropped connection is worth naming — it tells somebody to check their
  // signal rather than doubt what they typed. The raw string still is not safe
  // to echo, so recognise the case and return our own sentence.
  if (/network|fetch failed|failed to fetch|timeout|offline|tls|secure connection/i.test(message)) {
    return words.offline ?? words.fallback;
  }

  // Everything else — schema cache misses, constraint violations, permission
  // denials, expired tokens — is a sentence about the database. It stays in
  // Sentry and never reaches the page.
  return words.fallback;
}
