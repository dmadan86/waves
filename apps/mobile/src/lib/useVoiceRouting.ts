import { useQuery } from '@tanstack/react-query';

import { useViewerId } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { useEntitlement } from '@/lib/useEntitlement';
import { streamsToCloud } from '@/lib/voiceRoutingPure';

/**
 * Whether this person's mic streams live to Deepgram (Plus, Pro, the Pro trial)
 * or listens on the phone and sends the text to the agent (Free, including
 * commands earned with a reward ad). Not known yet reads as "streams": the
 * server refuses a stream for Free anyway, and a paid person must never be
 * downgraded because a read was slow.
 */
export function useVoiceStreamsToCloud(): boolean {
  const viewerId = useViewerId();
  const { tier } = useEntitlement();
  const plan = useQuery({
    queryKey: ['myPlanVoiceRouting', viewerId],
    enabled: viewerId !== null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<unknown> => {
      const { data, error } = await backend.rpc('waves_my_plan');
      if (error) throw error;
      return data;
    },
  });
  if (plan.isPending && plan.fetchStatus !== 'idle') return true;
  return streamsToCloud(plan.data, tier);
}
