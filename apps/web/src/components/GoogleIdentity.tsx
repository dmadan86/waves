'use client';

/**
 * Signing in with Google without leaving the page.
 *
 * The button beside this one sends the browser to Supabase's `/authorize`,
 * which sends it to Google, which sends it back — three hostnames to reach
 * your own account, and the middle one belongs to neither party. Google
 * Identity Services does the same work in place: its button opens Google's own
 * popup, the popup closes, and a signed **identity token** arrives in a
 * callback here. `signInWithGoogleCredential` exchanges it. Nothing navigates.
 *
 * What this component is careful about.
 *
 * **The nonce is generated before the sheet is configured, and used twice.**
 * Google is given its SHA-256 (hex) and stamps that into the token; Supabase is
 * given the raw value and checks the hash matches. That is what stops a token
 * minted for some other site from being a sign-in here, and it is why the two
 * halves cannot be generated independently. Getting them the wrong way round
 * fails at Supabase with a nonce mismatch and nowhere earlier.
 *
 * **It offers both of Google's ways in.** The card in the corner (One Tap)
 * names the account already signed into the browser, so the usual case is one
 * tap; the button is what somebody who dismissed it, or who has no Google
 * session, still has. Both hand back the same credential.
 *
 * **It renders Google's button, not ours.** The credential flow starts only
 * from a button GIS itself drew, or from One Tap; a styled `<button>` of our
 * own has no way to ask for a token. So the pill next to it stays as the
 * fallback, and `onUnavailable` hands the screen back when the script is
 * blocked, the client id is unset, or the browser refuses the popup.
 *
 * **It never runs for somebody already signed in.** There is no identity-token
 * form of `linkIdentity`, so a guest going through here would be signed into a
 * different account and lose theirs (ADR-006). The client refuses it; this
 * simply is not rendered in that case.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** The shape of GIS this file uses, rather than a dependency for six fields. */
interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        nonce: string;
        auto_select?: boolean;
        itp_support?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type: 'standard';
          theme: 'outline';
          size: 'large';
          shape: 'pill';
          text: 'continue_with';
          logo_alignment: 'center';
          width?: number;
          locale?: string;
        },
      ): void;
      prompt(): void;
      cancel(): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

/**
 * A random value and the digest Google will stamp into the token.
 *
 * 32 bytes of `getRandomValues`, base64 for the raw half; the hash is spelled
 * out as lowercase hex because that is the representation Supabase compares
 * against, not because anything here reads it.
 */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { raw, hashed };
}

/** Load GIS once per document, and resolve to null rather than throwing. */
function loadGsi(): Promise<GoogleIdentityApi | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.google?.accounts?.id) return Promise.resolve(window.google);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement('script');
    const done = () => resolve(window.google ?? null);
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', () => resolve(null), { once: true });
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
}

export interface GoogleIdentityProps {
  /** Exchange the token. Rejects like any other sign-in failure. */
  onCredential: (idToken: string, nonce: string) => Promise<void>;
  /** Called once when this cannot be offered, so the pill can take over. */
  onUnavailable: () => void;
  /** Called once Google has actually drawn its button, so the pill can go. */
  onReady: () => void;
  /** BCP-47 tag for Google's own button text. */
  locale: string;
}

export function GoogleIdentity({
  onCredential,
  onUnavailable,
  onReady,
  locale,
}: GoogleIdentityProps) {
  const hostId = useId();
  const host = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  // Each of these is re-created on every render by the caller. Google's button
  // must not be torn down and redrawn for that, so the live ones are kept in
  // refs and the effect that draws depends only on the locale. They are
  // assigned in an effect rather than during render: a ref written while
  // rendering is a value React is entitled to discard.
  const handler = useRef(onCredential);
  const giveUp = useRef(onUnavailable);
  const drawn = useRef(onReady);
  const exchanging = useRef(false);

  useEffect(() => {
    handler.current = onCredential;
    giveUp.current = onUnavailable;
    drawn.current = onReady;
  }, [onCredential, onUnavailable, onReady]);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const draw = useCallback(async () => {
    if (!clientId || !host.current) {
      giveUp.current();
      return;
    }
    const gsi = await loadGsi();
    if (!gsi || !host.current) {
      giveUp.current();
      return;
    }

    const { raw, hashed } = await makeNonce();
    gsi.accounts.id.initialize({
      client_id: clientId,
      nonce: hashed,
      // No `use_fedcm_for_prompt`: Google deprecated it and now ignores it,
      // because One Tap goes through FedCM on browsers that have it either
      // way. Passing it would only suggest this code chooses something.
      auto_select: false,
      itp_support: true,
      callback: (response) => {
        if (!response.credential) return;
        // Google's button stays live while Supabase is being called, and One
        // Tap can answer over the top of it. Two exchanges of two different
        // tokens race to set the session, and the later answer wins whichever
        // account it belongs to — so the second is dropped rather than sent.
        if (exchanging.current) return;
        exchanging.current = true;
        void handler.current(response.credential, raw).finally(() => {
          exchanging.current = false;
        });
      },
    });

    gsi.accounts.id.renderButton(host.current, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'center',
      width: Math.round(Math.min(400, host.current.getBoundingClientRect().width || 320)),
      locale,
    });
    // One Tap: the card that drops into the top corner naming the Google
    // account already signed into this browser, so the common case is one tap
    // and no sheet at all. It is the same credential and the same callback as
    // the button — this only asks for it unprompted.
    //
    // It is allowed to decline silently. Google suppresses the card if it was
    // dismissed too often, if there is no Google session, or if the browser
    // has no FedCM, and none of those is a fault. Asked for before the button
    // is checked below, so a rejected *button* does not also cost the card.
    gsi.accounts.id.prompt();

    // `renderButton` resolves nothing and throws nothing when Google declines
    // the client id or the origin — it simply leaves the host empty. Taken as
    // success that is the worst outcome available: the pill is hidden on the
    // strength of a button that is not there, and the card then offers no way
    // in at all. So what is on screen decides, one frame later, because the
    // button is Google's to insert and not necessarily inserted by the time
    // the call returns.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!host.current?.childElementCount) {
      giveUp.current();
      return;
    }

    setReady(true);
    drawn.current();
  }, [clientId, locale]);

  useEffect(() => {
    let live = true;
    void draw().catch(() => {
      if (live) giveUp.current();
    });
    return () => {
      live = false;
      window.google?.accounts.id.cancel();
    };
  }, [draw]);

  // Occupies no space until Google has drawn something, so the card does not
  // reflow around an empty box on a browser that will never fill it.
  return <div id={hostId} ref={host} className="gsi-host" hidden={!ready} />;
}
