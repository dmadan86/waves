/**
 * Brings a person back to the invite they opened before they had an account.
 *
 * Mounted once, inside the auth provider. The moment the session is a real
 * account (signed up, logged in, or a guest who upgraded in place) it takes the
 * remembered invite, if any, and opens the join screen with `resume=1`, which
 * completes the join by itself. A guest session does nothing: they have not
 * finished creating the account yet, and the note waits for them.
 *
 * Only a sign-in this launch can use the note. A session that was already a
 * real account when the app loaded did not come from the attempt that saved
 * it, so the note is dropped rather than applied to whoever that is.
 */
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { pendingInvite, resumeRoute } from '@/lib/pendingInvite';

export function PendingInviteResume() {
  const { session, loading, isGuest } = useAuth();
  const userId = session?.user.id ?? null;
  const resumedFor = useRef<string | null>(null);
  // Whether the first settled state of this launch was already a real account.
  const startedSignedIn = useRef<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (startedSignedIn.current === null) {
      startedSignedIn.current = Boolean(userId) && !isGuest;
      if (startedSignedIn.current) {
        resumedFor.current = userId;
        void pendingInvite.clear();
        return;
      }
    }
    if (!userId || isGuest) return;
    // Once per account per launch; the note itself is single-use too.
    if (resumedFor.current === userId) return;
    resumedFor.current = userId;
    void pendingInvite.take().then((token) => {
      if (token) router.replace(resumeRoute(token));
    });
  }, [loading, userId, isGuest]);

  return null;
}
