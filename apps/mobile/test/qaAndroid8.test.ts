/**
 * Device re-test of #1875/#1876 (Android, 2026-11-26): the three that still failed, plus the
 * Review button label. Source checks where vitest cannot render (see vitest.config.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Language, STRINGS_BY_LANGUAGE } from '@/i18n';

const src = (path: string): string => readFileSync(join(__dirname, '../src', path), 'utf8');

describe('Personal Save stays above the keyboard on edge-to-edge Android', () => {
  it('pads for the keyboard on every platform, not only iOS', () => {
    const entry = src('app/personal/entry.tsx');
    expect(entry).toContain('behavior="padding"');
    expect(entry).not.toMatch(/Platform\.OS === 'ios' \? 'padding'/);
  });
});

describe('a member balance is read from the viewer side everywhere', () => {
  for (const file of ['app/group/[id]/members.tsx', 'app/group/[id]/settings.tsx']) {
    it(`${file} colours and speaks the row through directionForViewer`, () => {
      expect(src(file)).toMatch(/direction=\{directionForViewer\(/);
    });
  }
});

describe('owes-you wording points the right way', () => {
  const hi = STRINGS_BY_LANGUAGE[Language.Hi];
  it('Hindi owes-you labels never say "you have to give"', () => {
    for (const text of [
      hi.misc.balanceOwesYou,
      hi.misc.settleLeftOwes,
      hi.misc.settleOwesYou,
      hi.voice.owesYou,
      hi.voice.ansTheyOweYou,
      hi.tabs.owesYou,
    ]) {
      expect(text).not.toMatch(/देना है|देने हैं/);
    }
  });
  it('owes-you and you-owe differ in every language', () => {
    for (const language of [Language.En, Language.Ta, Language.Hi, Language.Ar]) {
      const m = STRINGS_BY_LANGUAGE[language].misc;
      expect(m.balanceOwesYou).not.toBe(m.balanceOwes);
      expect(m.settleOwesYou).not.toBe(m.settleYouOweHeading);
    }
  });
});

describe('a receiver-recorded payment is one mutation, shown confirmed', () => {
  it('the hook no longer queues a second transition naming a client-made id', () => {
    const hooks = src('data/hooks.ts');
    const start = hooks.indexOf('export function useRecordSettlement');
    const body = hooks.slice(start, hooks.indexOf('\nexport function', start + 10));
    expect(body).not.toContain('SettlementTransition');
    expect(body).toContain('confirmed: viewerIsPayee');
  });
});

describe('Review bar button label fits', () => {
  it('shows the short label and speaks the full one', () => {
    const captures = src('app/(tabs)/captures.tsx');
    expect(captures).toContain('label={t.captures.justMePersonalShort}');
    expect(captures).toContain('accessibilityLabel={t.captures.justMePersonal}');
    for (const language of [Language.En, Language.Ta, Language.Hi, Language.Ar]) {
      expect(STRINGS_BY_LANGUAGE[language].captures.justMePersonalShort.length).toBeLessThan(14);
    }
  });
});
