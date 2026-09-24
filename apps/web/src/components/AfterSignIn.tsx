'use client';

/**
 * Finishes whatever a sign-in was started for.
 *
 * Two journeys queue something before leaving for Google or Apple (see
 * `lib/guestSwitch`): a guest switching to the account they already have, whose
 * groups are joined again here, and somebody on a join link who chose to sign
 * in first, who is taken back to it. Watching the session rather than living
 * in the callback route is what makes the in-page Google sign-in (One Tap,
 * which never visits the callback) finish the same way.
 *
 * A queue is only honoured for `QUEUE_TTL_MS` after it was made, so a switch
 * somebody abandoned is not applied to whoever signs in on this browser next.
 */

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';

import { useAuth } from '@/lib/auth';
import { rejoin, requeueFailed, takeAfterSignIn } from '@/lib/guestSwitch';
import { waves } from '@/lib/waves';

export function AfterSignIn() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const signedIn = Boolean(session && session.user.is_anonymous !== true);
  // The callback route is still exchanging the code and will navigate on its
  // own; acting now would race it. It re-renders here once it has moved on.
  const settling = pathname === '/auth/callback';

  useEffect(() => {
    if (!signedIn || settling) return;
    const next = takeAfterSignIn();
    if (!next) return;
    if (next.kind === 'join') {
      router.replace(`/join#${encodeURIComponent(next.token)}`);
      return;
    }
    void rejoin(
      next.tokens,
      (token) => waves.acceptInvite({ token, claimMemberId: null }),
      (caught) => Sentry.captureException(caught, { tags: { where: 'web.guestSwitch.rejoin' } }),
    ).then(({ to, failed }) => {
      requeueFailed(failed, next.attempts);
      router.replace(to);
    });
  }, [signedIn, settling, router]);

  return null;
}
