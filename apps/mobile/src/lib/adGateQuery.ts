import { readGateStatus } from './adGates';

export const adGateQuery = (profileId: string | null) => ({
  queryKey: ['bannerGate', profileId],
  queryFn: () => readGateStatus(profileId!),
  staleTime: 5 * 60_000,
});
