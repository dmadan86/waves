'use client';

/**
 * The consent screen for somebody else's agent.
 *
 * Supabase's OAuth 2.1 server is the authorization server named in
 * `/.well-known/oauth-protected-resource/api/mcp`. An agent sends a person to
 * `…/auth/v1/oauth/authorize`, Supabase decides the request is well formed, and
 * then sends the browser *here* with one query parameter: `authorization_id`.
 * Nothing else in the URL is load-bearing, and nothing else in it is trusted.
 *
 * This is a second consent screen, next to `/developers/authorize`, and the two
 * are deliberately not merged. That one speaks to the developer API in
 * `apps/api`, which mints its own tokens against its own registered clients and
 * its own granular scopes. This one speaks to Supabase, which mints an ordinary
 * Supabase session. Same words on the page, different servers underneath, and a
 * page that tried to serve both would have to guess which one it was talking to
 * on every call.
 *
 * Three decisions worth stating, because they are the whole security of the
 * screen:
 *
 * 1. **It never navigates to anything it was given.** The only address this
 *    page will send a browser to is the `redirect_url` Supabase returns from
 *    `approve`/`deny`, built server-side from the client's *registered*
 *    redirect. A page that bounced an error back to an address in its own query
 *    string would be an open redirect wearing an OAuth costume.
 *
 * 2. **A failure renders no Approve button.** If the details call fails — a
 *    spent authorization, an unknown id, a stale session — the page says so and
 *    stops. There is no path from an error to a granted token.
 *
 * 3. **The client's logo is never rendered.** `logo_uri` is a URL chosen by
 *    whoever registered the client, and this is the one screen where a
 *    convincing Waves logo would be worth forging. Fetching it would also
 *    report the viewer to that host at the moment they are deciding whether to
 *    trust it. The name and website are shown as text, marked unverified.
 *
 * And one honesty decision. The scopes Supabase speaks here are `openid`,
 * `email` and `profile`, which describe an identity token and say nothing about
 * anybody's money. What is actually handed over is a Supabase session that
 * reaches `/api/mcp` with this person's own RLS — their groups, expenses,
 * balances and settlements. Reciting the scope names would be accurate and
 * misleading, so the page describes what the token can really do.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/waves';
// Which parameter is trusted, which response arrived, and which of the
// client's strings may be rendered — decided in `lib/oauthConsent`, where it
// is tested without a browser or a session. See `test/oauthConsent.test.ts`.
import { nextStep, readAuthorizationId, type PendingConsent } from '@/lib/oauthConsent';

export default function OauthConsentPage() {
  return (
    <AppFrame current={Section.Developers}>
      {() => (
        <Suspense fallback={null}>
          <Consent />
        </Suspense>
      )}
    </AppFrame>
  );
}

function Consent() {
  const { t } = useStrings();
  const router = useRouter();
  const search = useSearchParams();

  // The one parameter that matters. Absent or empty means the link is
  // malformed, which is answered without asking the server anything.
  const authorizationId = useMemo(
    () => readAuthorizationId(new URLSearchParams(search.toString())),
    [search],
  );

  const [pending, setPending] = useState<PendingConsent | null>(null);
  const [loading, setLoading] = useState(authorizationId !== null);
  /** Set means: no Approve is rendered, ever, on this load. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<'approve' | 'deny' | null>(null);

  useEffect(() => {
    if (!authorizationId) return;
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (error) throw error;
        if (!active) return;
        const step = nextStep(data);
        // Already consented once: Supabase hands back only somewhere to go, and
        // there is nothing left to ask. Its address, not the query string's.
        if (step.kind === 'redirect') {
          window.location.replace(step.url);
          return;
        }
        setPending(step.pending);
      } catch (caught) {
        if (!active) return;
        setRefusal(
          friendlyError(caught, 'web.oauth.consent', {
            fallback: t.developers.consent.refusedBody,
            offline: t.errors.offline,
            tooMany: t.errors.tooMany,
          }),
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId, t.developers.consent.refusedBody, t.errors.offline, t.errors.tooMany]);

  /**
   * Approve and deny are the same shape and differ only in which call is made,
   * so they are one function. `skipBrowserRedirect` keeps the navigation here
   * rather than inside the SDK: a decision that failed must leave the person on
   * this page with a message, not half-way to somebody else's site.
   */
  const decide = useCallback(
    async (choice: 'approve' | 'deny') => {
      if (!pending || deciding) return;
      setDeciding(choice);
      setFailure(null);
      try {
        const call =
          choice === 'approve'
            ? supabase.auth.oauth.approveAuthorization
            : supabase.auth.oauth.denyAuthorization;
        const { data, error } = await call.call(supabase.auth.oauth, pending.authorizationId, {
          skipBrowserRedirect: true,
        });
        if (error) throw error;
        // `replace`, so Back does not walk into a spent authorization.
        window.location.replace(data.redirect_url);
        // Deliberately left busy: the navigation is what ends this page.
      } catch (caught) {
        setFailure(
          friendlyError(caught, `web.oauth.${choice}`, {
            fallback: t.errors.couldNotSave,
            offline: t.errors.offline,
            tooMany: t.errors.tooMany,
          }),
        );
        setDeciding(null);
      }
    },
    [deciding, pending, t.errors.couldNotSave, t.errors.offline, t.errors.tooMany],
  );

  const back = (
    <button type="button" className="btn soft" onClick={() => router.push('/')}>
      {t.developers.consent.back}
    </button>
  );

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{t.developers.consent.title}</h1>
        </div>

        <section className="panel">
          {!authorizationId ? (
            <>
              <p className="error">{t.developers.consent.badRequest}</p>
              {back}
            </>
          ) : loading ? (
            <SkeletonRows rows={4} amount={false} lead={false} />
          ) : refusal || !pending ? (
            /* A security boundary, not a hiccup: nothing on this branch renders
               Approve, and nothing on it can navigate to a caller's address. */
            <>
              <p className="error">{t.developers.consent.refused}</p>
              <p className="muted" style={{ marginBlockStart: 8 }}>
                {refusal ?? t.developers.consent.refusedBody}
              </p>
              <div style={{ marginBlockStart: 14 }}>{back}</div>
            </>
          ) : (
            <>
              <h2>{fill(t.developers.consent.wants, { app: pending.clientName })}</h2>

              {/* Said before anything flattering about the client. Whoever
                  registered it chose that name, and this screen is where a
                  borrowed one would pay off. */}
              <p className="muted" style={{ marginBlockStart: 6 }}>
                {t.agents.unverified}
              </p>

              <p className="muted" style={{ marginBlockStart: 6 }}>
                {fill(t.agents.signedInAs, { email: pending.email })}
              </p>

              {pending.clientUri ? (
                <p className="muted" style={{ marginBlockStart: 6 }}>
                  {t.developers.consent.website}
                  {': '}
                  {/* `noreferrer` as well as `noopener`: the client does not
                      need to be told that somebody reached it from a consent
                      screen for their own account. */}
                  <a
                    className="code"
                    dir="ltr"
                    href={pending.clientUri}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {pending.clientUri}
                  </a>
                </p>
              ) : null}

              <p className="muted" style={{ marginBlockStart: 6 }}>
                {t.developers.apps.redirects}
                {': '}
                {/* Where the code goes, as the server re-confirmed it against
                    the registration. Shown because it is the part of this
                    decision nobody can otherwise see. */}
                <span className="code" dir="ltr">
                  {pending.redirectUri}
                </span>
              </p>

              <h2 style={{ marginBlockStart: 16 }}>{t.agents.willBeAbleTo}</h2>
              <div className="list">
                {[t.agents.reads, t.agents.writes].map((line) => (
                  <div className="item" key={line} style={{ cursor: 'default' }}>
                    <span className="tile-emoji" aria-hidden>
                      <Check size={18} strokeWidth={2} />
                    </span>
                    <span className="grow">
                      <span className="title">{line}</span>
                    </span>
                  </div>
                ))}
              </div>

              <p className="muted" style={{ marginBlockStart: 10 }}>
                {t.agents.asYou}
              </p>
              <p className="muted" style={{ marginBlockStart: 6 }}>
                {t.agents.neverMoves}
              </p>

              {failure ? (
                <p className="error" role="alert" style={{ marginBlockStart: 12 }}>
                  {failure}
                </p>
              ) : null}

              <div className="people" style={{ marginBlockStart: 16 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={deciding !== null}
                  aria-busy={deciding === 'approve'}
                  onClick={() => void decide('approve')}
                >
                  {deciding === 'approve'
                    ? t.developers.consent.approving
                    : t.developers.consent.approve}
                </button>
                <button
                  type="button"
                  className="btn soft"
                  disabled={deciding !== null}
                  aria-busy={deciding === 'deny'}
                  onClick={() => void decide('deny')}
                >
                  {deciding === 'deny' ? t.agents.denying : t.agents.deny}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
      <aside className="detail" />
    </div>
  );
}
