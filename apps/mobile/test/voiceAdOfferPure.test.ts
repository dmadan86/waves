import { describe, expect, it } from 'vitest';

import type { AgentFallbackReason } from '@/components/VoiceAgentPanel';
import { shouldAutoOfferVoiceAd } from '@/lib/voiceAdOfferPure';

describe('shouldAutoOfferVoiceAd', () => {
  it('keeps a usable basic expense, command or local answer quiet after quota fallback', () => {
    expect(shouldAutoOfferVoiceAd('quota', true)).toBe(false);
  });

  it('offers after quota fallback when basic parsing misses or cannot answer an AI question', () => {
    expect(shouldAutoOfferVoiceAd('quota', false)).toBe(true);
  });

  it.each<AgentFallbackReason | undefined>([undefined, 'timeout', 'unavailable', 'error'])(
    'does not offer for %s',
    (reason) => {
      expect(shouldAutoOfferVoiceAd(reason, false)).toBe(false);
      expect(shouldAutoOfferVoiceAd(reason, true)).toBe(false);
    },
  );
});
