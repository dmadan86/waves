/**
 * Plus includes advanced AI voice (50 commands a month), Pro has 150: the
 * copy must say so in every locale and never call voice Pro-only.
 */

import { describe, expect, it, vi } from 'vitest';
import { VOICE_AGENT_PLUS_MONTHLY, VOICE_AGENT_PRO_MONTHLY } from '@waves/core';

import { fill, plural, STRINGS_BY_LANGUAGE } from '@/i18n';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('expo-localization', () => ({ getLocales: () => [] }));

describe('paywall voice copy', () => {
  it('uses 50 for Plus and 150 for Pro', () => {
    expect(VOICE_AGENT_PLUS_MONTHLY).toBe(50);
    expect(VOICE_AGENT_PRO_MONTHLY).toBe(150);
  });

  for (const [locale, t] of Object.entries(STRINGS_BY_LANGUAGE)) {
    it(`${locale}: the Plus tagline is short and the voice line carries the count`, () => {
      expect(t.paywall.plusTagline).not.toContain('50');
      expect(t.paywall.featureVoice).toContain('{commands}');
      expect(fill(t.paywall.featureVoice, { commands: 50 })).toContain('50');
      expect(t.upgradeScreen.plansBody).toContain('50');
      expect(t.upgradeScreen.plansBody).toContain('150');
    });
  }
});

describe('Free voice copy', () => {
  for (const [locale, t] of Object.entries(STRINGS_BY_LANGUAGE)) {
    it(`${locale}: "What stays free?" lists the 10 monthly AI voice commands`, () => {
      expect(t.paywall.freeVoice).toContain('10');
    });
  }
});

describe('Pro trial copy', () => {
  for (const [locale, t] of Object.entries(STRINGS_BY_LANGUAGE)) {
    it(`${locale}: days left in the badge and the menu row, commands left in the voice screen`, () => {
      for (const n of [1, 2, 3, 11, 15]) {
        expect(plural(locale, n, t.paywall.trialBadge).length).toBeGreaterThan(3);
        expect(plural(locale, n, t.upgradeTrial).length).toBeGreaterThan(3);
      }
      expect(plural('en', 3, STRINGS_BY_LANGUAGE.en.paywall.trialBadge)).toBe(
        'Pro trial · 3 days left',
      );
      expect(plural('en', 1, STRINGS_BY_LANGUAGE.en.upgradeTrial)).toBe('1 day of Pro left');
      expect(t.paywall.keepPro.length).toBeGreaterThan(2);
      expect(fill(t.voice.agentTrialQuotaLeft, { left: '15', limit: '20' })).toContain('15');
      expect(fill(t.voice.agentTrialQuotaLeft, { left: '15', limit: '20' })).toContain('20');
      const until = fill(t.voice.agentTrialQuotaLeftUntil, {
        left: '15',
        limit: '20',
        date: '20 Nov',
      });
      expect(until).toContain('15');
      expect(until).toContain('20 Nov');
    });
  }
});
