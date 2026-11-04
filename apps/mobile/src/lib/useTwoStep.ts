import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useFlagEnabled } from '@/lib/flags';
import { useViewerId } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { deviceId } from '@/lib/device';
import { functionErrorCode, trustThisPhone, type TrustResult } from '@/lib/twoStep';
import { syncEngine } from '@/sync';

export interface TwoStepStatus {
  sessionVerified: boolean;
  hasPhone: boolean;
  hasAuthenticator: boolean;
  pendingDevice: boolean;
  requiring: { groupId: string; name: string }[];
}

export const TWO_STEP_STATUS_KEY = ['two-step-status'];

async function fetchStatus(): Promise<TwoStepStatus> {
  const { data, error } = await backend.rpc('waves_two_step_status');
  if (error) throw new Error(error.message);
  return data as TwoStepStatus;
}

/** Quiet: a missing function (older server) is just "no status". */
export function useTwoStepStatus() {
  const viewer = useViewerId();
  return useQuery({
    queryKey: [...TWO_STEP_STATUS_KEY, viewer],
    queryFn: fetchStatus,
    enabled: !!viewer,
    retry: false,
  });
}

/** Whether two-step screens should be reachable at all. */
export function useTwoStepAvailable(): boolean {
  const flag = useFlagEnabled('company_two_step');
  const status = useTwoStepStatus().data;
  return flag || (status?.requiring.length ?? 0) > 0;
}

/** Trust this phone (optionally with a typed code); refreshes status and sync on success. */
export function useTrustPhone() {
  const viewer = useViewerId();
  const client = useQueryClient();
  return useCallback(
    async (code?: string): Promise<TrustResult> => {
      if (!viewer) return { status: 'unavailable' };
      const result = await trustThisPhone(viewer, await deviceId(), { code });
      void client.invalidateQueries({ queryKey: TWO_STEP_STATUS_KEY });
      if (result.status === 'trusted') void syncEngine.flush();
      return result;
    },
    [viewer, client],
  );
}

export async function startAuthenticator(): Promise<{ secret: string; uri: string }> {
  const { data, error } = await backend.functions.invoke('two-step-authenticator', {
    body: { action: 'start' },
  });
  if (error) throw new Error((await functionErrorCode(error)) ?? 'FAILED');
  return data as { secret: string; uri: string };
}

export async function confirmAuthenticator(code: string): Promise<'ok' | 'badCode' | 'failed'> {
  const { error } = await backend.functions.invoke('two-step-authenticator', {
    body: { action: 'confirm', code },
  });
  if (!error) return 'ok';
  return (await functionErrorCode(error)) === 'BAD_CODE' ? 'badCode' : 'failed';
}
