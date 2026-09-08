'use client';

/**
 * The consent screen — the one place in Waves where somebody is asked to give
 * software the right to act as them.
 *
 * The API's `GET /oauth/authorize` never redirects anywhere a caller named; it
 * checks the shape of the request and sends the browser *here*, carrying the
 * parameters. Whether the client, the redirect and the scopes are real is
 * decided by `GET /developer/consent`, under this person's own session, before
 * anything is drawn.
 *
 * Which makes the refusal the important half of this file. If that preview call
 * fails — unknown client, a redirect the developer never registered, a scope
 * wider than the registration — the page says so and stops. It does not offer
 * Approve, and it does not send the browser anywhere, least of all to the
 * address in the query string: bouncing an error back to an unregistered
 * redirect is an open redirect wearing an OAuth costume, and rendering a
 * consent screen for one is teaching people to approve a delivery the developer
 * never asked for.
 *
 * Approving posts back to `POST /oauth/authorize` with this person's session.
 * The code is minted on the server and the address to continue to is *built
 * there*, from the redirect its own RPC has just re-confirmed. This page
 * navigates to what it is handed and never to what it was given.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import {
  approve,
  consentPreview,
  isSignedOut,
  isUnconfigured,
  readConsentQuery,
  serverSentence,
  type ConsentPreview,
} from '@/lib/developerApi';

export default function AuthorizePage() {
  return (
    <AppFrame current={Section.Developers}>
      {() => (
        <Suspense fallback={null}>
          <Authorize />
        </Suspense>
      )}
    </AppFrame>
  );
}

function Authorize() {
  const { t } = useStrings();
  const router = useRouter();
  const search = useSearchParams();

  // The request as it arrived. Null means the link itself is malformed, which
  // is answered without asking the server anything.
  const consent = useMemo(() => readConsentQuery(new URLSearchParams(search.toString())), [search]);

  const [preview, setPreview] = useState<ConsentPreview | null>(null);
  const [loading, setLoading] = useState(consent !== null);
  /** Why this request will not be shown. Set means: no Approve, ever. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    if (!consent) return;
    let active = true;
    void (async () => {
      try {
        const found = await consentPreview(consent);
        if (active) setPreview(found);
      } catch (caught) {
        if (!active) return;
        setRefusal(
          isUnconfigured(caught)
            ? t.developers.notConfigured
            : // A stale session is not this application misbehaving, and saying
              // "Waves will not show this request" about it would send somebody
              // to argue with a developer who did nothing wrong.
              isSignedOut(caught)
              ? t.developers.signInAgain
              : friendlyError(caught, 'web.developers.consent', {
                  // The API's refusals are written for the person who caused
                  // them ("that redirect address is not registered for this
                  // application"), which is exactly what somebody deciding
                  // whether to trust this screen needs to read.
                  fallback: serverSentence(caught) ?? t.developers.consent.refusedBody,
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
  }, [
    consent,
    t.developers.consent.refusedBody,
    t.developers.notConfigured,
    t.developers.signInAgain,
    t.errors.offline,
    t.errors.tooMany,
  ]);

  const onApprove = useCallback(async () => {
    if (!consent || approving) return;
    setApproving(true);
    setFailure(null);
    try {
      const target = await approve(consent);
      // Where the server says to go, which is not where the query string said.
      // `replace` so Back does not walk into a spent authorization.
      window.location.replace(target);
      // Deliberately left busy: the navigation is what ends this page.
    } catch (caught) {
      setFailure(
        // `invalid_grant` here is the session, not the grant: the API maps a
        // stale login onto RFC 6749's vocabulary rather than calling it a
        // malformed request.
        isSignedOut(caught)
          ? t.developers.signInAgain
          : friendlyError(caught, 'web.developers.approve', {
              fallback: serverSentence(caught) ?? t.errors.couldNotSave,
              offline: t.errors.offline,
              tooMany: t.errors.tooMany,
            }),
      );
      setApproving(false);
    }
  }, [
    approving,
    consent,
    t.developers.signInAgain,
    t.errors.couldNotSave,
    t.errors.offline,
    t.errors.tooMany,
  ]);

  const words: Record<string, string> = t.developers.scope;
  const back = (
    <button type="button" className="btn soft" onClick={() => router.push('/developers')}>
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
          {!consent ? (
            <>
              <p className="error">{t.developers.consent.badRequest}</p>
              {back}
            </>
          ) : loading ? (
            <SkeletonRows rows={4} amount={false} lead={false} />
          ) : refusal || !preview ? (
            /* A security boundary, not a hiccup: no Approve is rendered, and
               nothing on this branch can navigate to the caller's address. */
            <>
              <p className="error">
                {refusal === t.developers.signInAgain
                  ? t.developers.signInAgain
                  : t.developers.consent.refused}
              </p>
              {refusal === t.developers.signInAgain ? null : (
                <p className="faint" style={{ marginBlockStart: 8 }}>
                  {refusal ?? t.developers.consent.refusedBody}
                </p>
              )}
              <div style={{ marginBlockStart: 14 }}>{back}</div>
            </>
          ) : (
            <>
              <h2>{fill(t.developers.consent.wants, { app: preview.name })}</h2>
              {preview.ownerName ? (
                <p className="muted" style={{ marginBlockStart: 6 }}>
                  {fill(t.developers.consent.by, { owner: preview.ownerName })}
                </p>
              ) : null}
              {preview.description ? (
                <p className="faint" style={{ marginBlockStart: 6 }}>
                  {preview.description}
                </p>
              ) : null}
              {preview.websiteUrl ? (
                <p className="faint" style={{ marginBlockStart: 6 }}>
                  {t.developers.consent.website}
                  {': '}
                  <a
                    className="code"
                    dir="ltr"
                    href={preview.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {preview.websiteUrl}
                  </a>
                </p>
              ) : null}

              <p className="faint" style={{ marginBlockStart: 6 }}>
                {t.developers.apps.redirects}
                {': '}
                {/* The address the code will be delivered to, which the server
                    has just confirmed against the registration. Shown because
                    it is the part of this decision nobody can otherwise see. */}
                <span className="code" dir="ltr">
                  {consent.redirectUri}
                </span>
              </p>

              <h2 style={{ marginBlockStart: 16 }}>{t.developers.consent.ableTo}</h2>
              <div className="list">
                {preview.scope_descriptions.map((entry) => (
                  <div className="item" key={entry.scope} style={{ cursor: 'default' }}>
                    <span className="tile-emoji" aria-hidden>
                      ✓
                    </span>
                    <span className="grow">
                      <span className="title">{words[entry.scope] ?? entry.description}</span>
                      <span className="meta code" dir="ltr">
                        {entry.scope}
                      </span>
                    </span>
                  </div>
                ))}
              </div>

              {failure ? (
                <p className="error" role="alert" style={{ marginBlockStart: 12 }}>
                  {failure}
                </p>
              ) : null}

              <div className="people" style={{ marginBlockStart: 16 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={approving}
                  aria-busy={approving}
                  onClick={() => void onApprove()}
                >
                  {approving ? t.developers.consent.approving : t.developers.consent.approve}
                </button>
                <button
                  type="button"
                  className="btn soft"
                  disabled={approving}
                  onClick={() => router.push('/developers')}
                >
                  {t.developers.consent.cancel}
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
