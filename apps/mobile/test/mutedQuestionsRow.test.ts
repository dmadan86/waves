import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFS, muteKind, mutedCount, resetMuted } from '@waves/core';

import { plural, STRINGS_BY_LANGUAGE } from '../src/i18n';

vi.mock('expo-localization', () => ({ getLocales: () => [] }));

describe('muted questions row', () => {
  it('shows only while something is muted, and hides after the reset', () => {
    expect(mutedCount(DEFAULT_PREFS)).toBe(0);
    const muted = muteKind(muteKind(DEFAULT_PREFS, 'date'), 'payer');
    expect(mutedCount(muted)).toBe(2);
    expect(mutedCount(resetMuted(muted))).toBe(0);
  });

  it('counts a kind muted by repeated skips', () => {
    expect(mutedCount({ ...DEFAULT_PREFS, skips: { date: 99 } })).toBe(1);
  });

  it('labels the count in every language', () => {
    const hint = (l: 'en' | 'ta' | 'hi' | 'ar', n: number): string =>
      plural(l, n, STRINGS_BY_LANGUAGE[l].followUps.resetHint);
    expect(hint('en', 3)).toBe('3 muted');
    expect(hint('ar', 1)).toBe('سؤال واحد مكتوم');
    for (const l of ['ta', 'hi', 'ar'] as const) expect(hint(l, 2)).not.toContain('{n}');
  });
});
