/**
 * The authorised AI assistants as a query, shared by the Settings row (which
 * shows the count) and the Connected apps screen (which lists and revokes
 * them). One key, so revoking on the list updates the Settings row without a
 * second fetch.
 */
import { useQuery } from '@tanstack/react-query';

import { backend } from '@/lib/backend';
import { listConnectedApps } from '@/lib/connectedApps';

export const CONNECTED_APPS_QUERY_KEY = ['connected-apps'] as const;

/** Grants change only when somebody authorises or revokes, so a minute is plenty. */
const STALE_MS = 60_000;

export function useConnectedApps() {
  return useQuery({
    queryKey: CONNECTED_APPS_QUERY_KEY,
    queryFn: () => listConnectedApps(backend.auth.oauth),
    staleTime: STALE_MS,
  });
}
