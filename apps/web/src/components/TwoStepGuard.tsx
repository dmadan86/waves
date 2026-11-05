'use client';

/** Sends a signed-in reader to the two-step screen before a company that requires it. */

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth';
import { needsTwoStep, type TwoStepStatus } from '@/lib/twoStep';
import { supabase } from '@/lib/waves';

export function useTwoStepStatus(): TwoStepStatus | null | undefined {
  const { profileId } = useAuth();
  // undefined: still asking. null: no answer, so no gate (the server's RLS is the real one).
  const [status, setStatus] = useState<TwoStepStatus | null | undefined>(undefined);
  useEffect(() => {
    if (!profileId) return;
    let active = true;
    void supabase.rpc('waves_two_step_status').then(({ data, error }) => {
      if (active) setStatus(error ? null : (data as TwoStepStatus));
    });
    return () => {
      active = false;
    };
  }, [profileId]);
  return profileId ? status : null;
}

export function TwoStepGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const status = useTwoStepStatus();
  const target = needsTwoStep(pathname, status ?? null, typeof window === 'undefined' ? '' : window.location.search);
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
  if (status === undefined || target) return null;
  return <>{children}</>;
}
