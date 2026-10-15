import { useQuery } from '@tanstack/react-query';

import { useViewerId } from '@/lib/auth';
import { readAdsStatus } from '@/lib/adsSdk';

/**
 * Whether the privacy screen shows the "Ad choices" row: only for people who can
 * be offered a reward ad at all (the flag is on for them, Free, not a guest, old
 * enough) — a person who is never shown an ad has no ad choices to make. Being at
 * today's cap still counts. The server decides; this only asks.
 */
export function useAdChoicesVisible(): boolean {
  const viewerId = useViewerId();
  const query = useQuery({
    queryKey: ['adChoicesVisible', viewerId],
    enabled: viewerId !== null,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const status = await readAdsStatus();
      return !!status && (status.eligible || status.reason === 'capped');
    },
  });
  return query.data === true;
}
