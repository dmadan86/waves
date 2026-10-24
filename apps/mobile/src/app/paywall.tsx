/**
 * /paywall is unified into /settings/upgrade. Redirect immediately.
 *
 * The route still exists (and is still guarded behind `paywallEnabled` in
 * _layout.tsx) so existing deep-links and `router.push('/paywall')` calls
 * keep working. Everything is handled in `settings/upgrade.tsx`.
 */

import { useEffect } from 'react';

import { router } from '@/lib/navigation';

export default function PaywallRedirect() {
  useEffect(() => {
    // Replace so the back stack goes back to the caller, not to this redirect.
    router.replace('/settings/upgrade');
  }, []);
  return null;
}
