/**
 * Crash reporting, on terms Waves can live with.
 *
 * TDR §11 asks for crash-free sessions above 99.5%, which needs something
 * counting sessions and crashes. The awkward part is what else that something
 * picks up on the way: a Sentry event, left to its defaults, carries the URL of
 * the request that failed, the last few console lines, and whatever the app
 * handed it as context. In an expense splitter that is a list of who ate with
 * whom, the number they were invited on, and the handle they pay from.
 *
 * So nothing leaves without going through `scrub` from @waves/core — the same
 * policy the web view and the edge functions use, tested there rather than
 * here. This file is the wiring; `packages/core/src/observability/scrub.ts` is
 * the rule.
 *
 * With no DSN set this is inert: `init` returns immediately and every other
 * function is a no-op. A developer without a Sentry account runs the app with
 * no reporting rather than a crash on boot, and no build step is required to
 * make that true.
 */

import * as Sentry from '@sentry/react-native';

import { scrub } from '@waves/core';

import { buildIdentity } from './buildIdentity';

/**
 * A DSN is public by design — it only permits *writing* events, which is why it
 * ships in every binary that reports a crash. It is `EXPO_PUBLIC_` for the same
 * reason the anon key is: no secret is being kept here. The token that can
 * *read* the project, `SENTRY_AUTH_TOKEN`, is a build-time secret and never
 * enters the bundle (TDR §11).
 */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** Whether anything is being reported at all. Useful in a settings screen. */
export const reportingEnabled = Boolean(DSN);

export function initObservability(): void {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'development' : 'production'),

    // Which build this event came from, by commit.
    //
    // The SDK already sets a release from the native version, and two builds of
    // the same version share it — so a stack trace from a phone could not say
    // whether it predated a fix. That cost a round: a `TypeError` in the
    // personal-placement planner was read as a live bug when its line numbers
    // belonged to a build from before the fix, which only the line numbers gave
    // away. A tag says it outright.
    //
    // A tag, deliberately, and not `dist`: source maps are uploaded against the
    // release and dist the native build reports, and overriding either would
    // leave every future stack trace unsymbolicated — which is a far worse
    // trade than the one it buys.
    initialScope: { tags: { commit: buildIdentity().commit ?? 'unknown' } },

    // The one number TDR §11 is actually about.
    enableAutoSessionTracking: true,

    // Never attach the user's email, phone or IP, whatever the SDK can see.
    sendDefaultPii: false,

    // A screenshot of a group screen is a full disclosure of the ledger, and a
    // view hierarchy is the same thing in text. Neither is worth a crash fix.
    attachScreenshot: false,
    attachViewHierarchy: false,

    // Sampled in production because tracing is per-transaction billing and a
    // splitting app is chatty; full rate locally, where the traces are read.
    tracesSampleRate: __DEV__ ? 1.0 : 0.1,

    beforeSend: (event) => scrub(event),
    beforeBreadcrumb: (breadcrumb) => {
      // Console breadcrumbs are the one class the scrubber cannot make safe:
      // `console.log('saving', expense)` produces a sentence with a description
      // in it that matches no pattern and sits under no known key. The rest —
      // navigation, fetch, lifecycle — is diagnosis, and goes through scrub
      // like everything else.
      if (breadcrumb.category === 'console') return null;
      return scrub(breadcrumb);
    },
  });
}

/**
 * Ties a report to an account without saying who owns it.
 *
 * The id is the Supabase user id — an opaque UUID, and the only way to tell
 * "one person hit this fifty times" from "fifty people did". Turning it back
 * into a person requires the database, which requires passing RLS.
 */
export function identifyForReporting(userId: string | null): void {
  if (!reportingEnabled) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/**
 * Report something the app handled but should not have had to.
 *
 * A failed sync or a refused mutation is not a crash — the user sees a message
 * and carries on — but it is exactly the class of bug that never gets reported
 * by hand.
 */
export function reportHandled(error: unknown, where: string): void {
  // Also to the device log (logcat / Console), so a tester can see it without Sentry.
  console.warn(`[handled] ${where}:`, describeError(error, where));
  showOnTestBuild(error, where);
  if (!reportingEnabled) return;
  // Couple-space paths handle decrypted text: send only a fixed code, never the original.
  Sentry.captureException(isSensitivePath(where) ? new Error(safeCode(error)) : error, {
    tags: { where },
  });
}

/** Rentals and e2ee errors can carry decrypted tenant data in their message. */
export const isSensitivePath = (where: string): boolean =>
  where.startsWith('rentals.') || where.startsWith('e2ee') || where.startsWith('couple');

/** The only codes and exception classes that may be printed or sent from a sensitive path. */
const SAFE_CODES = new Set([
  'E2EE_DECODE_FAILED',
  'E2EE_BAD_SHAPE',
  'E2eeError',
  'SyntaxError',
  'TypeError',
  'RangeError',
  'Error',
  'TransientMailboxError',
  'AbortError',
  'PGRST301',
  '22023',
  '42501',
  '23505',
  '23503',
]);

/** Fixed category for an error: an approved code or class name, else plain `Error`. */
export function safeCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && SAFE_CODES.has(code)) return code;
  return error instanceof Error && SAFE_CODES.has(error.name) ? error.name : 'Error';
}

/** What goes to the log and the test-build alert: name/code only on sensitive paths. */
export function describeError(error: unknown, where: string): string {
  if (isSensitivePath(where)) {
    // A server error's code (SQLSTATE / PGRST) names the failure and carries no user data.
    // A wrapper (e.g. a transient-dependency error) carries the server error as its cause.
    const inner = (error as { cause?: unknown } | null)?.cause ?? error;
    const code = (inner as { code?: unknown } | null)?.code;
    const shown = typeof code === 'string' && /^([0-9A-Z]{5}|PGRST\d+)$/.test(code) ? code : null;
    const base = safeCode(error);
    return shown && shown !== base ? `${base} [${shown}]` : base;
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Wraps the root component for the native error boundary and route tracing. */
export const withObservability = Sentry.wrap;

/**
 * Test builds only (the `preview` update channel): show a couple-space or rentals failure
 * on screen, because release builds write no JS logs and these failures are otherwise silent.
 */
function showOnTestBuild(error: unknown, where: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require('expo-updates') as { channel?: string | null };
    if (Updates.channel !== 'preview') return;
    if (!where.startsWith('rentals.') && !where.startsWith('e2ee')) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Alert } = require('react-native') as typeof import('react-native');
    const detail = describeError(error, where);
    // eslint-disable-next-line no-restricted-syntax -- test builds only, outside any React tree
    Alert.alert(`Test build: ${where}`, detail.slice(0, 500));
  } catch {
    // Diagnostics only.
  }
}
