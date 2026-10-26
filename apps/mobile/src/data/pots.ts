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

// The adapter exposes the same read/RPC methods used by the pot client.
const api = createWavesClient({
  supabase: backend as Parameters<typeof createWavesClient>[0]['supabase'],
});
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

/** The sync projection predates pot_id. Read current tags online alongside pots
 * until the mirror carries them, rather than allowing pot bills into settle-up. */
export function usePotExpenseTags(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['group', groupId, 'pot-expense-tags'],
    enabled: Boolean(groupId) && enabled,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await backend
        .from('expenses')
        .select('id, currentVersion:expense_versions!expenses_current_version_id_fkey ( pot_id )')
        .eq('group_id', groupId);
      if (error) throw error;
      const rows = (data ?? []) as unknown as {
        id: string;
        currentVersion: { pot_id: string | null } | null;
      }[];
      return Object.fromEntries(
        rows.flatMap((row) =>
          row.currentVersion?.pot_id ? [[row.id, row.currentVersion.pot_id]] : [],
        ),
      );
    },
  });
}
