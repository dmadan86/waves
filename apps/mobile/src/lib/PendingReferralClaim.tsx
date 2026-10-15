/**
 * Claims the referral code somebody opened before they had an account.
 *
 * Mounted once, inside the auth provider. The moment the session is a real
 * account it hands the remembered code to `waves_claim_referral` and clears it
 * once the server has answered for good: accepted, or refused for a reason that
 * will not change (not a new account, already referred, an unknown code, their
 * own code). A guest session, a network failure or an answer this build does not
 * know keeps the code for the next launch. Nothing is shown: the reward comes
 * later, from using Waves, and the card on the invite screen reports it.
 */
import { useEffect, useRef } from 'react';

import { claimReferral } from '@/data/api';
import { captureInstallReferrerOnce } from '@/lib/installReferrer';
import { useAuth } from '@/lib/auth';
import { pendingReferral } from '@/lib/pendingReferral';
import { isDefinitiveRefusal } from '@/lib/referral';

export function PendingReferralClaim() {
  const { session, loading, isGuest } = useAuth();
  const userId = session?.user.id ?? null;
  const triedFor = useRef<string | null>(null);

  // Android, first launch of an install: a code the Play link carried becomes a
  // waiting code, before any account exists. Never replaces a deep link's.
  useEffect(() => {
    void captureInstallReferrerOnce();
  }, []);

  useEffect(() => {
    if (loading || !userId || isGuest) return;
    // Once per account per launch.
    if (triedFor.current === userId) return;
    triedFor.current = userId;
    void (async () => {
      const code = await pendingReferral.peek();
      if (!code) return;
      try {
        const outcome = await claimReferral(code);
        if (outcome.ok || isDefinitiveRefusal(outcome.reason)) await pendingReferral.clear();
      } catch {
        // Offline or the server is busy: keep the code, try next launch.
        triedFor.current = null;
      }
    })();
  }, [loading, userId, isGuest]);

  return null;
}
