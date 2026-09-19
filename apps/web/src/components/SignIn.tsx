'use client';

/**
 * The door for a real user: Google, Apple, an email-and-password account, or a
 * passwordless email link (ADR-006 names them). A guest with an invite link
 * does not come through here at all — they open the link and the anonymous
 * session is minted for them.
 *
 * Apple was here on the phone long before it was here. The app has a native
 * sheet to present and this does not, which is the whole of the difference:
 * both end up at the same Supabase provider, and the Services id that flow uses
 * has been configured and working on the project for months. What was missing
 * was a button.
 *
 * Which Supabase call the password form makes — sign up, sign in, or upgrade a
 * guest in place — is decided by @waves/core inside the client, never guessed
 * here (see `withPassword`).
 */

import { useState } from 'react';

import { IdentityError } from '@waves/core';

import { GOOGLE_CREDENTIAL_NEEDS_REDIRECT } from '@waves/api-client';

import { useAuth } from '@/lib/auth';
import { GoogleIdentity } from '@/components/GoogleIdentity';
import { fill, type WebStrings } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

/**
 * Our own sentence, when the thing that failed was the form rather than the
 * server.
 *
 * `checkPassword` throws before any round trip, and what it throws was written
 * for the person typing — "use at least 8 characters". Running that through
 * `friendlyError` would replace a useful instruction with "could not sign in",
 * which is both wrong (nothing was refused) and unhelpful (they cannot guess
 * what to change). Validation is not a backend failure and is not treated as
 * one; the core's English is the last resort for a code with no words yet.
 */
function validationWords(caught: unknown, t: WebStrings): string | null {
  if (!(caught instanceof IdentityError)) return null;
  switch (caught.code) {
    case 'PASSWORD_TOO_SHORT':
      return t.errors.passwordTooShort;
    case 'PASSWORD_TOO_COMMON':
      return t.errors.passwordTooCommon;
    case 'EMAIL_NOT_VALID':
      return t.dash.notAnEmail;
    default:
      return caught.message;
  }
}

/**
 * The two provider marks, drawn rather than lettered.
 *
 * The Google button used to carry a bare capital "G". That was fine while it
 * stood alone and merely looked homemade; beside an Apple button it stops being
 * a matter of taste. Both brands publish rules for their sign-in buttons, and
 * both rules are about the mark: Apple's require their own glyph, white on a
 * black button, and Google's require the four-colour G on white behind a
 * hairline. A letter typed in the page font is neither.
 *
 * Same paths as the app's `SocialTile`, at fixed hex for the same reason given
 * there — a brand glyph that followed our palette would no longer be the brand
 * glyph. `aria-hidden`, because the button's own words are its name; a reader
 * that announced "G, Continue with Google" would say it twice.
 */
function GoogleMark() {
  return (
    <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="#FFFFFF"
        d="M17.05 12.54c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.63-1.71-3.19-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.1 8.79.73 1.06 1.6 2.25 2.74 2.21 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.15.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.29-.88-2.31-3.49zM14.86 5.62c.61-.74 1.02-1.77.91-2.8-.88.04-1.94.59-2.57 1.32-.56.65-1.06 1.7-.93 2.7.98.08 1.98-.5 2.59-1.22z"
      />
    </svg>
  );
}

/**
 * The eye on the password field.
 *
 * Drawn rather than imported: this file already carries two brand marks as
 * paths, and one icon package for one glyph is a dependency for a dependency's
 * sake. `aria-hidden`, because the button around it carries the words — a
 * reader that announced the icon as well would say it twice.
 */
function EyeMark({ off }: { off: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
      />
      <circle cx={12} cy={12} r={3.1} fill="none" stroke="currentColor" strokeWidth={1.7} />
      {off ? (
        <path stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" d="M4 20 20 4" />
      ) : null}
    </svg>
  );
}

export function SignIn() {
  const { t, locale } = useStrings();
  const {
    signInWithGoogle,
    signInWithGoogleCredential,
    signInWithApple,
    signInWithEmail,
    withPassword,
    session,
  } = useAuth();
  const [busy, setBusy] = useState<null | 'google' | 'apple' | 'password' | 'link'>(null);
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether the password is showing. False on every load, deliberately: a
   * field that remembered it had been revealed would show somebody's password
   * to whoever opened the laptop next.
   */
  const [shown, setShown] = useState(false);
  /**
   * Whether Google's own button is on screen. Until it is, the pill below
   * stands in — a browser that blocks the script, or has no client id
   * configured, keeps a working Google sign-in and never sees a gap where one
   * used to be. Somebody already signed in never gets the in-page flow at all:
   * an identity token cannot *link* an account, only replace it (ADR-006).
   */
  const [gsiDrawn, setGsiDrawn] = useState(false);
  const inPageGoogle = session === null;

  async function onGoogleCredential(idToken: string, nonce: string) {
    setBusy('google');
    setError(null);
    try {
      await signInWithGoogleCredential(idToken, nonce);
      // No navigation and nothing to clear: `onAuthChange` swaps this card out.
    } catch (caught) {
      setBusy(null);
      // The one refusal that is not a failure: somebody is already signed in,
      // so this has to be a link, and only the redirect can link. Take it,
      // rather than telling them something went wrong when nothing did.
      if (caught instanceof Error && caught.message === GOOGLE_CREDENTIAL_NEEDS_REDIRECT) {
        await onGoogle();
        return;
      }
      setError(
        friendlyError(caught, 'web.signIn.googleCredential', {
          fallback: t.errors.couldNotSignIn,
          offline: t.errors.offline,
          tooMany: t.errors.tooMany,
        }),
      );
    }
  }

  async function onGoogle() {
    setBusy('google');
    setError(null);
    try {
      await signInWithGoogle(); // navigates away; no return
    } catch (caught) {
      setBusy(null);
      setError(
        friendlyError(caught, 'web.signIn.google', {
          fallback: t.errors.couldNotSignIn,
          offline: t.errors.offline,
          tooMany: t.errors.tooMany,
        }),
      );
    }
  }

  async function onApple() {
    setBusy('apple');
    setError(null);
    try {
      await signInWithApple(); // navigates away; no return
    } catch (caught) {
      setBusy(null);
      setError(
        friendlyError(caught, 'web.signIn.apple', {
          fallback: t.errors.couldNotSignIn,
          offline: t.errors.offline,
          tooMany: t.errors.tooMany,
        }),
      );
    }
  }

  // A local check only, to catch the obvious typo before the round trip; the
  // real validation is the server's.
  function looksLikeEmail(address: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  }

  async function onPassword(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!looksLikeEmail(address)) {
      setError(t.dash.notAnEmail);
      return;
    }
    setBusy('password');
    setError(null);
    try {
      // The core picks the call; a guest is upgraded in place, keeping groups.
      await withPassword(address, password, mode);
    } catch (caught) {
      setError(
        validationWords(caught, t) ??
          friendlyError(caught, 'web.signIn.password', {
            fallback: t.errors.couldNotSignIn,
            offline: t.errors.offline,
            tooMany: t.errors.tooMany,
          }),
      );
    } finally {
      setBusy(null);
    }
  }

  async function onMagicLink() {
    const address = email.trim();
    if (!looksLikeEmail(address)) {
      setError(t.dash.notAnEmail);
      return;
    }
    setBusy('link');
    setError(null);
    try {
      await signInWithEmail(address);
      setSent(true);
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.signIn.magicLink', {
          fallback: t.errors.couldNotSignIn,
          offline: t.errors.offline,
          tooMany: t.errors.tooMany,
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="signin-wrap">
      {/*
        The illustrated half.

        A lone card centred in a field of colour is a login box, not a product:
        somebody who followed a link here learns nothing about what they have
        arrived at. This half carries the name, one honest sentence, and a drawn
        picture of the thing itself — a spending bar and a short list of people,
        which is what the app actually shows you.

        It is decoration, so the picture is `aria-hidden` and the whole half is
        dropped below 960px: an illustration that pushes the fields under the
        fold on a phone is worse than no illustration.

        Deliberately no feature list. Every claim would need saying in four
        languages, and the phone's own list — works offline, scan a receipt — is
        not true here: neither ships on the web.
      */}
      {/*
        One wordmark, outside both halves.

        It used to live inside the illustrated panel, which is hidden below
        960px — so a phone showed a login form with no name on it at all, to
        exactly the person most likely to have arrived from a link and to need
        telling where they are. Out here it is absolutely placed over the
        picture at desktop width and sits above the card on a phone: one
        element, one position in the document, two layouts.
      */}
      <div className="brand door-brand">
        <span className="brand-mark" aria-hidden>
          ₹
        </span>
        {t.dash.signInTitle}
      </div>

      <aside className="door-art">
        <div className="door-stage" aria-hidden>
          <span className="door-orb" />
          <span className="door-tile door-tile-a">
            <span className="door-tile-num" dir="ltr">
              ₹1,240
            </span>
            <span className="door-tile-bars">
              <i style={{ height: '38%' }} />
              <i style={{ height: '62%' }} />
              <i style={{ height: '46%' }} />
              <i style={{ height: '88%' }} />
              <i style={{ height: '70%' }} />
            </span>
          </span>
          <span className="door-tile door-tile-b">
            <span className="door-row">
              <i className="door-dot" />
              <i className="door-line" />
            </span>
            <span className="door-row">
              <i className="door-dot door-dot-2" />
              <i className="door-line door-line-2" />
            </span>
            <span className="door-row">
              <i className="door-dot door-dot-3" />
              <i className="door-line door-line-3" />
            </span>
          </span>
        </div>

        <p className="door-tagline">{t.dash.signInBody}</p>
      </aside>

      {/* The ways in, and nothing else. The name sits on the other half, so
          repeating it here would be the same wordmark twice on one screen. */}
      <div className="door-form">
        <div className="signin-card">
          {sent ? (
            <>
              <h1 className="door-head">{t.dash.linkSentTitle}</h1>
              <p className="door-sub">{fill(t.dash.linkSentBody, { email: email.trim() })}</p>
            </>
          ) : (
            <>
              <h1 className="door-head">{t.dash.doorWelcome}</h1>
              <p className="door-sub">{t.dash.doorSub}</p>

              <form onSubmit={onPassword} className="door-fields">
                <label className="door-label" htmlFor="door-email">
                  {t.dash.emailLabel}
                </label>
                <input
                  id="door-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  placeholder={t.dash.emailPlaceholder}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ textAlign: 'start' }}
                />

                <label className="door-label" htmlFor="door-password">
                  {t.dash.passwordLabel}
                </label>
                {/* The eye sits inside the field's own box rather than beside
                    it, so the row reads as one control. Positioned to the
                    logical end, so in Arabic it mirrors with the field instead
                    of sitting over the first letter. */}
                <div className="door-secret">
                  <input
                    id="door-password"
                    type={shown ? 'text' : 'password'}
                    autoComplete={mode === 'sign_up' ? 'new-password' : 'current-password'}
                    value={password}
                    placeholder={t.dash.passwordPlaceholder}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ textAlign: 'start' }}
                  />
                  <button
                    type="button"
                    className="door-eye"
                    onClick={() => setShown((was) => !was)}
                    aria-label={shown ? t.dash.hidePassword : t.dash.showPassword}
                    aria-pressed={shown}
                  >
                    <EyeMark off={shown} />
                  </button>
                </div>

                <button type="submit" className="btn brand block" disabled={busy !== null}>
                  {busy === 'password'
                    ? t.dash.signingIn
                    : mode === 'sign_up'
                      ? t.dash.passwordSignUp
                      : t.dash.passwordSignIn}
                </button>
              </form>

              <p className="door-swap">
                <button
                  type="button"
                  className="linklike"
                  onClick={() => {
                    setError(null);
                    setMode((m) => (m === 'sign_in' ? 'sign_up' : 'sign_in'));
                  }}
                  disabled={busy !== null}
                >
                  {mode === 'sign_in' ? t.dash.toggleToSignUp : t.dash.toggleToSignIn}
                </button>
              </p>

              <div className="signin-or">{t.dash.orDivider}</div>

              {/*
                Google first, Apple second, on every platform.

                The app reorders these — Apple leads on iOS, where its
                guidelines want it at least as prominent as its neighbours — but
                the app knows what it is running on before it draws anything.
                This is server-rendered: a platform sniff here would produce one
                order on the server and possibly another in the browser, and
                React would throw the markup away and redraw. The guideline is
                satisfied without reordering, because both are the same
                full-width pill at the same size and corner; only the order is
                fixed.
              */}
              {inPageGoogle ? (
                <GoogleIdentity
                  onCredential={onGoogleCredential}
                  onReady={() => setGsiDrawn(true)}
                  onUnavailable={() => setGsiDrawn(false)}
                  locale={locale}
                />
              ) : null}

              {gsiDrawn ? null : (
                <button
                  type="button"
                  className="btn google"
                  onClick={onGoogle}
                  disabled={busy !== null}
                >
                  <GoogleMark />
                  {busy === 'google' ? t.dash.signingIn : t.dash.continueWithGoogle}
                </button>
              )}

              <button
                type="button"
                className="btn apple"
                onClick={onApple}
                disabled={busy !== null}
              >
                <AppleMark />
                {busy === 'apple' ? t.dash.signingIn : t.dash.continueWithApple}
              </button>

              <button
                type="button"
                className="btn soft block"
                onClick={onMagicLink}
                disabled={busy !== null}
              >
                {busy === 'link' ? t.dash.sendingLink : t.dash.sendMagicLink}
              </button>

              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : null}

              <p className="door-foot">{t.dash.guestInstead}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
