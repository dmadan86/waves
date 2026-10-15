import { useQuery } from '@tanstack/react-query';

import { useViewerId } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { parseProTrial, type ProTrial } from '@/lib/proTrial';

/** The automatic Pro trial this account is on, or null. Display only; the server enforces it. */
export function useProTrial(): ProTrial | null {
  const viewerId = useViewerId();
  const query = useQuery({
    queryKey: ['myProTrial', viewerId],
    enabled: viewerId !== null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProTrial | null> => {
      const { data, error } = await backend.rpc('waves_my_plan');
      if (error) throw error;
      return parseProTrial(data);
    },
  });
  return query.data ?? null;
}
