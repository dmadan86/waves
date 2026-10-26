import type { AgentFallbackReason } from '@/components/VoiceAgentPanel';

/** A quota refusal needs an offer only when basic voice could not help. */
export function shouldAutoOfferVoiceAd(
  fallbackReason: AgentFallbackReason | undefined,
  basicHandled: boolean,
): boolean {
  return fallbackReason === 'quota' && !basicHandled;
}
