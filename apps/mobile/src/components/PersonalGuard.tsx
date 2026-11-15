/**
 * The account wall in front of the private personal ledger: a guest session
 * cannot be signed back into, so there is nowhere for a private ledger to be
 * kept (`components/SignInWall`). The biometric check is the one app lock
 * (`lib/lock`), not a second gate here.
 */

import type { ReactNode } from 'react';

import { SignInWall } from '@/components/SignInWall';
import { useAuth } from '@/lib/auth';

export function PersonalGuard({ children }: { children: ReactNode }) {
  const { isGuest } = useAuth();
  if (isGuest) return <SignInWall area="personal" />;
  return <>{children}</>;
}
