/**
 * Plus includes advanced AI voice (50 commands a month), Pro has 150: the
 * copy must say so in every locale and never call voice Pro-only.
 */

import { describe, expect, it, vi } from 'vitest';
import { VOICE_AGENT_PLUS_MONTHLY, VOICE_AGENT_PRO_MONTHLY } from '@waves/core';

import { fill, STRINGS_BY_LANGUAGE } from '@/i18n';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('expo-localization', () => ({ getLocales: () => [] }));

describe('paywall voice copy', () => {
  it('uses 50 for Plus and 150 for Pro', () => {
    expect(VOICE_AGENT_PLUS_MONTHLY).toBe(50);
    expect(VOICE_AGENT_PRO_MONTHLY).toBe(150);
  });

  for (const [locale, t] of Object.entries(STRINGS_BY_LANGUAGE)) {
    it(`${locale}: the Plus tagline mentions 50 and the voice line takes a count`, () => {
      expect(t.paywall.plusTagline).toContain('50');
      expect(t.paywall.featureVoice).toContain('{commands}');
      expect(fill(t.paywall.featureVoice, { commands: 50 })).toContain('50');
      expect(t.upgradeScreen.plansBody).toContain('50');
      expect(t.upgradeScreen.plansBody).toContain('150');
    });
  }
});
