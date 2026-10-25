import { useEffect } from 'react';
import { useAdGate } from '@/lib/useAdGate';
import { registerAdGate } from '@/lib/adGateBridge';
export function AdGateHost() {
  const { requireAd, sheet } = useAdGate({ offerOwed: true });
  useEffect(() => registerAdGate(requireAd), [requireAd]);
  return sheet;
}
