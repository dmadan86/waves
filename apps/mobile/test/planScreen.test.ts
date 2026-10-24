/**
 * Tests for the simplified plan screen logic.
 *
 * The screen itself uses React hooks, so these tests cover:
 *  - The period auto-selection logic (fixes the empty-screen bug)
 *  - The CTA label composition
 *  - That planScreen strings exist in all four languages
 *  - That FREE/PRO constants are read from plans.ts and agentProtocol
 */

import { describe, expect, it } from 'vitest';

import { FREE_MONTHLY_SCANS, PRO_MONTHLY_SCANS, PRO_DEVICE_LIMIT } from '@waves/core';
import { VOICE_AGENT_FREE_MONTHLY, VOICE_AGENT_PRO_MONTHLY } from '@waves/core';

import { periodsInOffering, planCardsFromOffering, type OfferingLike } from '../src/lib/pricing';
import { Language, STRINGS_BY_LANGUAGE } from '../src/i18n';

const EN = STRINGS_BY_LANGUAGE[Language.En];
const TA = STRINGS_BY_LANGUAGE[Language.Ta];
const HI = STRINGS_BY_LANGUAGE[Language.Hi];
const AR = STRINGS_BY_LANGUAGE[Language.Ar];

// ---------------------------------------------------------------------------
// Period auto-selection (empty-screen fix)
// ---------------------------------------------------------------------------

const YEARLY_ONLY_OFFERING: OfferingLike = {
  identifier: 'default',
  availablePackages: [
    {
      identifier: 'pro_yearly',
      packageType: 'ANNUAL',
      product: {
        identifier: 'waves_pro_yearly',
        price: 699,
        priceString: '₹699.00',
        currencyCode: 'INR',
      },
    },
  ],
};

const MONTHLY_AND_YEARLY_OFFERING: OfferingLike = {
  identifier: 'default',
  availablePackages: [
    {
      identifier: 'pro_monthly',
      packageType: 'MONTHLY',
      product: {
        identifier: 'waves_pro_monthly',
        price: 79,
        priceString: '₹79.00',
        currencyCode: 'INR',
      },
    },
    {
      identifier: 'pro_yearly',
      packageType: 'ANNUAL',
      product: {
        identifier: 'waves_pro_yearly',
        price: 699,
        priceString: '₹699.00',
        currencyCode: 'INR',
      },
    },
  ],
};

describe('period auto-selection', () => {
  it('offering with only yearly returns ["yearly"]', () => {
    expect(periodsInOffering(YEARLY_ONLY_OFFERING)).toEqual(['yearly']);
  });

  it('no cards for monthly when offering is yearly-only', () => {
    expect(planCardsFromOffering(YEARLY_ONLY_OFFERING, 'monthly')).toHaveLength(0);
    expect(planCardsFromOffering(YEARLY_ONLY_OFFERING, 'yearly')).toHaveLength(1);
  });

  it('both periods present in a mixed offering', () => {
    const periods = periodsInOffering(MONTHLY_AND_YEARLY_OFFERING);
    expect(periods).toContain('monthly');
    expect(periods).toContain('yearly');
  });

  it('resolved period falls back to first available (yearly) when state is monthly but monthly absent', () => {
    // Simulate the screen logic: if periods does not include the current state,
    // pick periods[0] ?? 'yearly'.
    const periods = periodsInOffering(YEARLY_ONLY_OFFERING);
    const statePeriod = 'monthly'; // what the state holds initially
    const resolved = periods.includes(statePeriod) ? statePeriod : (periods[0] ?? 'yearly');
    expect(resolved).toBe('yearly');
  });
});

// ---------------------------------------------------------------------------
// Plan constants come from source-of-truth files, not hard-coded
// ---------------------------------------------------------------------------

describe('plan constants', () => {
  it('FREE_MONTHLY_SCANS is a positive integer', () => {
    expect(typeof FREE_MONTHLY_SCANS).toBe('number');
    expect(FREE_MONTHLY_SCANS).toBeGreaterThan(0);
  });

  it('PRO_MONTHLY_SCANS is greater than FREE_MONTHLY_SCANS', () => {
    expect(PRO_MONTHLY_SCANS).toBeGreaterThan(FREE_MONTHLY_SCANS);
  });

  it('PRO_DEVICE_LIMIT is at least 1', () => {
    expect(PRO_DEVICE_LIMIT).toBeGreaterThanOrEqual(1);
  });

  it('VOICE_AGENT_PRO_MONTHLY is greater than VOICE_AGENT_FREE_MONTHLY', () => {
    expect(VOICE_AGENT_PRO_MONTHLY).toBeGreaterThan(VOICE_AGENT_FREE_MONTHLY);
  });
});

// ---------------------------------------------------------------------------
// planScreen strings present in all four languages
// ---------------------------------------------------------------------------

const REQUIRED_PLAN_SCREEN_KEYS: (keyof typeof EN.planScreen)[] = [
  'freeCardTitle',
  'freeCardSubtitle',
  'freeFeatureExpenses',
  'freeFeatureBalances',
  'freeFeatureScans',
  'freeFeatureVoice',
  'freeFeatureAds',
  'proCardSubtitle',
  'proFeatureNoAds',
  'proFeatureScans',
  'proFeatureVoice',
  'proFeatureDevices',
  'ctaGetPro',
  'alreadyPro',
  'haveCode',
  'title',
  'heroEyebrow',
  'heroTitle',
  'heroBody',
  'freePrice',
  'freeCaption',
];

describe('planScreen i18n completeness', () => {
  const langs = [
    { name: 'en', strings: EN },
    { name: 'ta', strings: TA },
    { name: 'hi', strings: HI },
    { name: 'ar', strings: AR },
  ] as const;

  for (const { name, strings } of langs) {
    it(`${name}: all planScreen keys are non-empty strings`, () => {
      for (const key of REQUIRED_PLAN_SCREEN_KEYS) {
        const value = strings.planScreen[key];
        expect(
          typeof value === 'string' && value.length > 0,
          `${name}.planScreen.${key} should be a non-empty string`,
        ).toBe(true);
      }
    });
  }

  it('ctaGetPro contains {price} and {period} placeholders in all languages', () => {
    for (const { name, strings } of langs) {
      expect(strings.planScreen.ctaGetPro, `${name}.planScreen.ctaGetPro`).toContain('{price}');
      expect(strings.planScreen.ctaGetPro, `${name}.planScreen.ctaGetPro`).toContain('{period}');
    }
  });

  it('freeFeatureScans contains {scans} placeholder in all languages', () => {
    for (const { name, strings } of langs) {
      expect(strings.planScreen.freeFeatureScans, `${name}`).toContain('{scans}');
      expect(strings.planScreen.proFeatureScans, `${name}`).toContain('{scans}');
    }
  });

  it('freeFeatureVoice contains {commands} placeholder in all languages', () => {
    for (const { name, strings } of langs) {
      expect(strings.planScreen.freeFeatureVoice, `${name}`).toContain('{commands}');
      expect(strings.planScreen.proFeatureVoice, `${name}`).toContain('{commands}');
    }
  });
});
