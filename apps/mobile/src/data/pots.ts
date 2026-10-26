/** Pots are online RPCs until a later slice adds them to the offline mirror. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createWavesClient,
  type CreatePotInput,
  type RecordPotContributionInput,
  type PotMutationInput,
  type CarryPotInput,
} from '@waves/api-client';
import { backend } from '@/lib/backend';
import { useSync } from '@/sync';

const api = createWavesClient({ supabase: backend });
export const potKeys = { group: (groupId: string) => ['group', groupId, 'pots'] as const };

export function usePots(groupId: string) {
  return useQuery({
    queryKey: potKeys.group(groupId),
    queryFn: () => api.listPots(groupId),
    enabled: Boolean(groupId),
  });
}

function usePotMutation<T, R>(groupId: string, mutationFn: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  const { flush } = useSync();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      // A close creates ordinary settlements: pull those into the mirror too.
      await Promise.all([flush(), queryClient.invalidateQueries({ queryKey: ['group', groupId] })]);
    },
  });
}

/** Mutation ids belong to callers and remain stable through retries. */
export function useCreatePot(groupId: string) {
  return usePotMutation(groupId, (input: Omit<CreatePotInput, 'groupId'>) =>
    api.createPot({ ...input, groupId }),
  );
}
export function useRecordPotContribution(groupId: string) {
  return usePotMutation(groupId, (input: RecordPotContributionInput) =>
    api.recordPotContribution(input),
  );
}
export function useConfirmPotContribution(groupId: string) {
  return usePotMutation(groupId, (settlementId: string) =>
    api.confirmPotContribution(settlementId),
  );
}
export function useClosePot(groupId: string) {
  return usePotMutation(groupId, (input: PotMutationInput) => api.closePot(input));
}
export function useCarryPot(groupId: string) {
  return usePotMutation(groupId, (input: Omit<CarryPotInput, 'groupId'>) =>
    api.carryPot({ ...input, groupId }),
  );
}
