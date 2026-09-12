'use client';

/**
 * Where a provider sends the browser back — Google, Apple, or a mailed link.
 *
 * The client is configured not to read the URL on its own
 * (`detectSessionInUrl: false` in lib/waves.ts) so this is the one place a
 * code is exchanged for a session — deliberately explicit, so an invite link
 * carrying its own token is never mistaken for a login. Once the session is
 * written, `onAuthChange` in the AuthProvider re-renders the app and we send
 * the person to the dashboard.
 *
 * Reading the URL is `readOAuthCallback`'s job, not a `get('code')` here, and
 * the reason is that a redirect can mean three things rather than two. It used
 * to mean two: a code, or "Missing authorization code". That third case is a
 * redirect carrying neither a code nor an error, and it is what an identity
 * *link* looks like — a guest attaching Google or Apple to the account they
 * already have. Nothing is supposed to come back, because the session the
 * identity was just added to is the one already in this browser. Treating that
 * as a failure showed an error over a sign-in that had worked.
 *
 * The other two it settles properly as well. A provider that refuses answers
 * with `error` and often `error_description`, sometimes in the fragment rather
 * than the query, and a server misconfiguration comes back the same way — a
 * stale OAuth client secret surfaces here as `server_error` /
 * "Unable to exchange external code". None of that is shown to the reader:
 * `friendlyError` keeps backend sentences off the page and sends them to
 * Sentry, which is exactly where a message naming the real fault is wanted.
 * "Missing authorization code" was not that message.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { readOAuthCallback } from '@waves/core';

import { supabase } from '@/lib/waves';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

export default function AuthCallback() {
  const router = useRouter();
  const { t } = useStrings();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const callback = readOAuthCallback(window.location.href);
        if (callback.kind === 'error') throw new Error(callback.message);
        if (callback.kind === 'none') {
          // A link that added an identity to the session already held, or —
          // if there is no session — a round trip that came back with nothing
          // at all. The first is a success with nothing left to do; the second
          // is the failure the old "Missing authorization code" meant.
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error('Sign-in came back without a code');
        } else {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            callback.code,
          );
          if (exchangeError) throw exchangeError;
        }
        router.replace('/');
      } catch (caught) {
        setError(
          friendlyError(caught, 'web.auth.callback', {
            fallback: t.errors.couldNotSignIn,
            offline: t.errors.offline,
            tooMany: t.errors.tooMany,
          }),
        );
      }
    })();
  }, [router, t.errors.couldNotSignIn, t.errors.offline, t.errors.tooMany]);

  return (
    <div className="spinner-page">
      {error ? <p className="error">{error}</p> : <p>{t.dash.signingIn}</p>}
    </div>
  );
}
