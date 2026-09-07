'use client';

/**
 * `/join#<token>` — the link the app itself hands out (A47).
 *
 * This route existed nowhere and every durable group invite pointed at it: the
 * phone builds `https://app.wavs.co.in/join#<token>`, and the only join route
 * the web had was `/join/<token>`, so every QR and every shared link answered
 * 404. The whole growth loop ran into a missing page.
 *
 * The token is in the fragment on purpose. A fragment is not sent to the
 * server — not to Vercel's logs, not to a proxy, not in a `Referer` header when
 * the page later loads an image — so a link forwarded through three chats does
 * not leave the key to a group in somebody's access log. That is also why it
 * can only be read here, in the browser, after hydration.
 *
 * A bare `/join` with no fragment is not an error worth explaining: somebody
 * typed the address, or a chat app trimmed the link. It says the link does not
 * work, which is true and is all they can act on.
 */

import { useEffect, useState } from 'react';

import { JoinFlow } from '@/components/JoinFlow';
import { useStrings } from '@/i18n-context';

export default function JoinHashPage() {
  const { t } = useStrings();
  // `undefined` while the fragment has not been read yet — which is a different
  // thing from "there is no token", and must not flash the broken-link page at
  // somebody whose link is fine.
  const [token, setToken] = useState<string | undefined>(undefined);

  useEffect(() => {
    const read = () => {
      // Everything after the first '#'. Decoded, because a chat client may
      // percent-encode what it forwards.
      const raw = window.location.hash.replace(/^#/, '');
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        // A malformed escape is not a token; keep the raw text and let the
        // preview call refuse it.
      }
      setToken(decoded.trim());
    };
    read();
    // If somebody pastes a second link into the same tab, the fragment changes
    // without a navigation, and nothing else would notice.
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  if (token === undefined) {
    return (
      <main>
        <div className="card">
          <p className="muted">{t.join.opening}</p>
        </div>
      </main>
    );
  }

  if (token === '') {
    return (
      <main>
        <div className="card">
          <h1>{t.join.linkBroken}</h1>
          <p className="faint">{t.join.linkBrokenBody}</p>
        </div>
      </main>
    );
  }

  return <JoinFlow token={token} />;
}
