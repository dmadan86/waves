/**
 * `/r/<CODE>` — a friend's personal link, opened in the app.
 *
 * Nothing to show: the code is remembered (like a group invite before sign-up)
 * and the person goes on to the app, or to the welcome screen if they have no
 * account yet. `PendingReferralClaim` claims it once there is one. A link whose
 * code is not shaped like ours is simply ignored.
 */
import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { router } from '@/lib/navigation';
import { pendingReferral } from '@/lib/pendingReferral';
import { normalizeReferralCode } from '@/lib/referral';

export default function ReferralLinkScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const normalized = normalizeReferralCode(typeof code === 'string' ? code : null);
      if (normalized) await pendingReferral.remember(normalized);
      if (!cancelled) router.replace('/');
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  return null;
}
