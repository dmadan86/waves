import { describe, expect, it } from 'vitest';

import { adsTotals } from '../src/lib/ads';

describe('adsTotals', () => {
  it('adds up the days, reading bigint strings as numbers', () => {
    expect(
      adsTotals([
        { rewards: '4', voice_rewards: '3', scan_rewards: '1', cap_hits: '1' },
        { rewards: 2, voice_rewards: 0, scan_rewards: 2, cap_hits: 0 },
      ]),
    ).toEqual({ rewards: 6, voice: 3, scan: 3, capHits: 1 });
  });

  it('is zero with no days and ignores junk', () => {
    expect(adsTotals([])).toEqual({ rewards: 0, voice: 0, scan: 0, capHits: 0 });
    expect(
      adsTotals([{ rewards: 'x', voice_rewards: null as never, scan_rewards: 1, cap_hits: 0 }]),
    ).toEqual({ rewards: 0, voice: 0, scan: 1, capHits: 0 });
  });
});

import {
  creditDays,
  creditKnobs,
  rewardedCompletions,
  validateCreditSettings,
  type CreditSettings,
} from '../src/lib/ads';
const defaults = () =>
  ({
    ...Object.fromEntries(creditKnobs.map((k) => [k.key, k.defaultValue])),
    interstitial_video_enabled: false,
  }) as CreditSettings;

describe('credit reporting', () => {
  it('pivots credits and event counts per day and reason, newest first', () => {
    expect(
      creditDays([
        { day: '2026-10-24', reason: 'ad_voice', events: '2', credits: '12' },
        { day: '2026-10-25', reason: 'spend_scan', events: '3', credits: '6' },
        { day: '2026-10-24', reason: 'ad_voice', events: 1, credits: 4 },
        { day: '2026-10-24', reason: 'ad_voluntary', events: 1, credits: 6 },
      ]),
    ).toEqual([
      { day: '2026-10-25', earned: 0, spent: 6, reasons: { spend_scan: 3 } },
      { day: '2026-10-24', earned: 22, spent: 0, reasons: { ad_voice: 3, ad_voluntary: 1 } },
    ]);
    expect(creditDays([])).toEqual([]);
    expect(creditDays([{ day: 'x', reason: 'unknown', events: 'bad', credits: 9 }])).toEqual([
      { day: 'x', earned: 0, spent: 0, reasons: { unknown: 0 } },
    ]);
  });
  it('sums completions and always includes new placements', () => {
    const rows = rewardedCompletions([
      { placement: 'export_rewarded', completed: '2' },
      { placement: 'export_rewarded', completed: 3 },
      { placement: 'expense_interstitial', completed: 0 },
    ]);
    expect(rows).toContainEqual({ placement: 'export_rewarded', completed: 5 });
    expect(rows).toContainEqual({ placement: 'credit_voluntary', completed: 0 });
    expect(rows).toContainEqual({ placement: 'credit_offer', completed: 0 });
    expect(rows.some((r) => r.placement === 'expense_interstitial')).toBe(false);
  });
});
describe('credit settings validation', () => {
  it('accepts defaults and both video toggle states', () => {
    expect(() => validateCreditSettings(defaults())).not.toThrow();
    expect(() =>
      validateCreditSettings({ ...defaults(), interstitial_video_enabled: true }),
    ).not.toThrow();
  });
  it('checks every numeric boundary, fractions and missing values', () => {
    for (const knob of creditKnobs) {
      for (const value of [knob.min - 1, knob.max + 1, 1.5, NaN, undefined])
        expect(() =>
          validateCreditSettings({ ...defaults(), [knob.key]: value } as CreditSettings),
        ).toThrow(knob.label);
      for (const value of [knob.min, knob.max])
        expect(() => validateCreditSettings({ ...defaults(), [knob.key]: value })).not.toThrow();
    }
    expect(() =>
      validateCreditSettings({ ...defaults(), interstitial_video_enabled: 1 as never }),
    ).toThrow('boolean');
  });
});
