/**
 * Reading what Supabase's OAuth server said, before any of it reaches a screen.
 *
 * The consent page at `app/oauth/consent` is mostly I/O — one call out, one
 * decision, one navigation — and the parts of it that could actually hurt
 * somebody are decisions about *data*: which query parameter is trusted, which
 * of two response shapes arrived, and which of the client's own strings are
 * safe to render. Those live here so they can be tested without a browser, a
 * session, or a registered OAuth client, none of which a unit test has.
 *
 * Nothing here talks to Supabase. It reads; the caller acts.
 */

import { httpUrl } from './safeUrl';

/** A request that still needs a human decision. */
export interface PendingConsent {
  authorizationId: string;
  clientName: string;
  /** The client's own site, or null when it is not safe to render as a link. */
  clientUri: string | null;
  /** Where the code will be delivered, as the server re-confirmed it. */
  redirectUri: string;
  email: string;
}

export type ConsentStep =
  /** Already consented once: forward, and ask nothing. */
  | { readonly kind: 'redirect'; readonly url: string }
  /** Draw the screen. */
  | { readonly kind: 'consent'; readonly pending: PendingConsent };

/**
 * The only parameter this page trusts.
 *
 * Supabase sends exactly one thing worth reading, and everything else in the
 * URL is the caller's to invent. A blank or whitespace-only value is the same
 * as absent: it cannot identify an authorization, and treating it as one would
 * send an empty id to the server and render its refusal as though the request
 * had been real.
 */
export function readAuthorizationId(params: URLSearchParams): string | null {
  const raw = params.get('authorization_id');
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/** The two shapes `getAuthorizationDetails` can return, as this app reads them. */
interface DetailsShape {
  authorization_id: string;
  redirect_uri: string;
  client: { name: string; uri?: string | null };
  user: { email: string };
}
interface RedirectShape {
  redirect_url: string;
}

/**
 * Which of the two responses arrived, and what to do about it.
 *
 * The narrowing is `'authorization_id' in data`, which is what the SDK's own
 * types document — not a truthiness check on `redirect_url`, because a details
 * response that happened to carry an empty one would then be read as a
 * redirect to nowhere.
 *
 * `clientUri` is filtered on the way through rather than at the point it is
 * rendered. The client's `uri` is a string chosen by whoever registered it, and
 * a `javascript:` URL in an `href` on this origin is script execution on the
 * one screen where somebody is deciding whether to trust a stranger. Filtering
 * here means the screen cannot render an unfiltered one even by mistake.
 */
export function nextStep(data: DetailsShape | RedirectShape): ConsentStep {
  if (!('authorization_id' in data)) {
    return { kind: 'redirect', url: data.redirect_url };
  }
  return {
    kind: 'consent',
    pending: {
      authorizationId: data.authorization_id,
      clientName: data.client.name,
      clientUri: httpUrl(data.client.uri),
      redirectUri: data.redirect_uri,
      email: data.user.email,
    },
  };
}
