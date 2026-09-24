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
 * A fourth: a guest's Google or Apple login that already belongs to another
 * Waves account. Supabase refuses to attach it (one login, one account) and
 * says so with a generic `server_error`. That is not a failure to report — the
 * person has an account — so it offers to switch to it, carrying the groups
 * the guest joined across (`lib/guestSwitch`).
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

import { supabase, waves } from '@/lib/waves';
import { fill, plural } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { lastProvider, queueRejoin, rememberProvider } from '@/lib/guestSwitch';

/**
 * How many expenses the guest in this browser added themselves. Those stay
 * with the guest when they switch, so the screen says so before they choose.
 * Zero when anything about the question fails: it is a warning, not a gate.
 */
async function guestExpenseCount(guestId: string): Promise<number> {
  try {
    const { data: members } = await supabase
      .from('group_members')
      .select('id')
      .eq('profile_id', guestId);
    const ids = (members ?? []).map((row: { id: string }) => row.id);
    if (ids.length === 0) return 0;
    const { count } = await supabase
      .from('expenses')
      .select('id', { count: 'exact', head: true })
      .in('created_by', ids)
      .is('deleted_at', null);
    return count ?? 0;
  } catch {
    return 0;
  }
}

type Taken = { guestId: string | null; left: number };

export default function AuthCallback() {
  const router = useRouter();
  const { t, locale } = useStrings();
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<Taken | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const callback = readOAuthCallback(window.location.href);
        if (callback.kind === 'identity_taken') {
          // The guest session is untouched by the refusal: it is still the
          // one in this browser, and still who owns the groups joined so far.
          const { data } = await supabase.auth.getSession();
          const user = data.session?.user;
          const guestId = user?.is_anonymous === true ? user.id : null;
          setTaken({ guestId, left: guestId ? await guestExpenseCount(guestId) : 0 });
          return;
        }
        if (callback.kind === 'error') throw new Error(callback.message);
        if (callback.kind === 'none') {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error('Sign-in came back without a code');
        } else {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            callback.code,
          );
          if (exchangeError) throw exchangeError;
        }
        // Anything queued for after the sign-in (`AfterSignIn`) takes it from
        // the dashboard.
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

  const provider = lastProvider();

  const switchAccount = async () => {
    if (!taken) return;
    setSwitching(true);
    setError(null);
    try {
      if (taken.guestId) queueRejoin(taken.guestId);
      // Local only: the guest account stays on the server, still holding what
      // it added, and still a member of its groups.
      await supabase.auth.signOut({ scope: 'local' });
      rememberProvider(provider);
      const redirectTo = `${window.location.origin}/auth/callback`;
      // Nobody is signed in now, so this is a plain sign-in, not a link.
      await (provider === 'apple'
        ? waves.signInWithApple(redirectTo)
        : waves.signInWithGoogle(redirectTo));
    } catch (caught) {
      setSwitching(false);
      setError(
        friendlyError(caught, 'web.auth.switch', {
          fallback: t.errors.couldNotSignIn,
          offline: t.errors.offline,
          tooMany: t.errors.tooMany,
        }),
      );
    }
  };

  if (taken) {
    const providerName = provider === 'apple' ? 'Apple' : 'Google';
    return (
      <main className="guest">
        <div className="card">
          <h1>{fill(t.join.takenTitle, { provider: providerName })}</h1>
          <p>{t.join.takenBody}</p>
          {taken.left > 0 ? (
            <p className="faint">{plural(locale, taken.left, t.join.takenLeftBehind)}</p>
          ) : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button
          type="button"
          className="btn block lg"
          onClick={() => void switchAccount()}
          disabled={switching}
        >
          {t.join.takenSwitch}
        </button>
        <button
          type="button"
          className="btn soft block"
          onClick={() => router.replace('/')}
          disabled={switching}
        >
          {t.join.takenStay}
        </button>
      </main>
    );
  }

  return (
    <div className="spinner-page">
      {error ? <p className="error">{error}</p> : <p>{t.dash.signingIn}</p>}
    </div>
  );
}
