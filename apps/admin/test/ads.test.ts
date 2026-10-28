import { describe, expect, it } from 'vitest';

import { adsTotals, bannerStats, passiveStats } from '../src/lib/ads';

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

describe('bannerStats', () => {
  it('includes both placements with zero totals when empty', () => {
    expect(bannerStats([], '2026-11-02')).toEqual(
      ['review_banner', 'home_banner'].map((placement) => ({
        placement,
        shownToday: 0,
        failedToday: 0,
        shownLast7Days: 0,
        failedLast7Days: 0,
      })),
    );
  });
  it('sums bigint strings across an inclusive seven-day UTC window', () => {
    expect(
      bannerStats(
        [
          { day: '2026-11-02', placement: 'review_banner', shown: '3', failed: '1' },
          { day: '2026-11-02', placement: 'review_banner', shown: 2, failed: 1 },
          { day: '2026-10-27', placement: 'review_banner', shown: '4', failed: '2' },
          { day: '2026-10-26', placement: 'review_banner', shown: 99, failed: 99 },
          { day: '2026-11-03', placement: 'review_banner', shown: 99, failed: 99 },
          { day: '2026-11-02', placement: 'quota_rewarded', shown: 99, failed: 99 },
          { day: '2026-11-01', placement: 'home_banner', shown: '6', failed: 'bad' },
        ],
        '2026-11-02',
      ),
    ).toEqual([
      {
        placement: 'review_banner',
        shownToday: 5,
        failedToday: 2,
        shownLast7Days: 9,
        failedLast7Days: 4,
      },
      {
        placement: 'home_banner',
        shownToday: 0,
        failedToday: 0,
        shownLast7Days: 6,
        failedLast7Days: 0,
      },
    ]);
  });
});

describe('passiveStats', () => {
  it('sums clicks, CTR and paid micros over seven UTC days, tolerating missing columns', () => {
    const out = passiveStats(
      [
        {
          day: '2026-11-02',
          placement: 'native_list',
          shown: '100',
          failed: 1,
          clicked: '2',
          paid_micros: '3500000',
        },
        {
          day: '2026-10-26',
          placement: 'native_list',
          shown: 99,
          failed: 9,
          clicked: 9,
          paid_micros: 9,
        },
        { day: '2026-11-02', placement: 'settings_banner', shown: 4, failed: 0 },
      ],
      '2026-11-02',
    );
    expect(out.find((r) => r.placement === 'native_list')).toEqual({
      placement: 'native_list',
      shown: 100,
      clicked: 2,
      failed: 1,
      ctr: 0.02,
      paid: 3.5,
    });
    expect(out.find((r) => r.placement === 'settings_banner')?.shown).toBe(4);
    expect(out.find((r) => r.placement === 'voice_banner')?.ctr).toBe(0);
  });
});
