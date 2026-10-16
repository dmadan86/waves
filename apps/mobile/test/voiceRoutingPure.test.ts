import { describe, expect, it } from 'vitest';

import { PlanTier } from '@waves/core';

import { streamsToCloud } from '@/lib/voiceRoutingPure';

const NOW = new Date('2026-10-20T10:00:00Z');

describe('streamsToCloud', () => {
  it('streams for Plus and Pro, from the server or from the store', () => {
    expect(streamsToCloud({ plan: 'plus' }, PlanTier.Free, NOW)).toBe(true);
    expect(streamsToCloud({ plan: 'pro' }, PlanTier.Free, NOW)).toBe(true);
    expect(streamsToCloud({ plan: 'free' }, PlanTier.Pro, NOW)).toBe(true);
    expect(streamsToCloud(null, PlanTier.Pro, NOW)).toBe(true);
  });

  it('streams during the Pro trial and its 30-day voice pool', () => {
    expect(streamsToCloud({ plan: 'pro', trial: true }, PlanTier.Free, NOW)).toBe(true);
    expect(
      streamsToCloud({ plan: 'free', trialVoiceUntil: '2026-11-01T00:00:00Z' }, PlanTier.Free, NOW),
    ).toBe(true);
  });

  it('is Free (listens on the phone, text to the agent) otherwise', () => {
    expect(streamsToCloud({ plan: 'free' }, PlanTier.Free, NOW)).toBe(false);
    expect(streamsToCloud({ plan: 'free', scanLimit: 20 }, PlanTier.Free, NOW)).toBe(false);
    expect(
      streamsToCloud({ plan: 'free', trialVoiceUntil: '2026-10-01T00:00:00Z' }, PlanTier.Free, NOW),
    ).toBe(false);
    expect(streamsToCloud({ plan: 'free', trialVoiceUntil: 'junk' }, PlanTier.Free, NOW)).toBe(
      false,
    );
    expect(streamsToCloud(undefined, PlanTier.Free, NOW)).toBe(false);
    expect(streamsToCloud('free', PlanTier.Free, NOW)).toBe(false);
  });
});
