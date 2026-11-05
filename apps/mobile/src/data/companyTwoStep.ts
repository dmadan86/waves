import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { backend } from '@/lib/backend';

export interface TwoStepOverview {
  requireTwoStep: boolean;
  members: {
    memberId: string;
    name: string;
    role: string;
    hasFactor: boolean;
    /** Server-decided: the viewer outranks this person and may reset them. */
    canReset: boolean;
    appVersion: string | null;
  }[];
  pendingDevices: {
    requestId: string;
    memberId: string;
    name: string;
    platform: string | null;
    createdAt: string;
  }[];
}

/** First app version that understands two-step. Older phones cannot verify and lose the company. */
export const FIRST_TWO_STEP_VERSION = '1.3.2';

const key = (groupId: string) => ['company-two-step', groupId];

/** Members who would be locked out: older than the first two-step version, or unknown. */
export function membersNeedingUpdate(
  members: TwoStepOverview['members'],
  first = FIRST_TWO_STEP_VERSION,
): TwoStepOverview['members'] {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const older = (v: string) => {
    const a = parse(v);
    const b = parse(first);
    for (let i = 0; i < 3; i += 1) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
    }
    return false;
  };
  return members.filter((m) => !m.appVersion || older(m.appVersion));
}

/** Owner/manager only; `enabled` keeps everyone else off the server. */
export function useTwoStepOverview(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(groupId),
    enabled: enabled && !!groupId,
    retry: false,
    queryFn: async (): Promise<TwoStepOverview> => {
      const { data, error } = await backend.rpc('waves_company_two_step_overview', {
        p_group_id: groupId,
      });
      if (error) throw new Error(error.message);
      return data as TwoStepOverview;
    },
  });
}

const code = (message: string): string =>
  ['TWO_STEP_REQUIRED', 'FEATURE_OFF', 'NOT_ALLOWED'].find((c) => message.startsWith(c)) ??
  'FAILED';

function useRpc<V>(groupId: string, name: string, args: (v: V) => Record<string, unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (v: V) => {
      const { error } = await backend.rpc(name, args(v));
      if (error) throw new Error(code(error.message));
    },
    onSettled: () => client.invalidateQueries({ queryKey: key(groupId) }),
  });
}

export const useSetRequireTwoStep = (groupId: string) =>
  useRpc<boolean>(groupId, 'waves_company_set_two_step', (on) => ({
    p_group_id: groupId,
    p_on: on,
  }));

export const useResetTwoStep = (groupId: string) =>
  useRpc<string>(groupId, 'waves_two_step_reset', (memberId) => ({
    p_group_id: groupId,
    p_member_id: memberId,
  }));

export const useDecideDevice = (groupId: string) =>
  useRpc<{ requestId: string; approve: boolean }>(groupId, 'waves_two_step_decide_device', (v) => ({
    p_request_id: v.requestId,
    p_group_id: groupId,
    p_approve: v.approve,
  }));
