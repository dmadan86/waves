/** The Other currencies sheet follows the mockup, without the false "updated automatically" claim. Source-pinned. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { STRINGS_BY_LANGUAGE } from '../src/i18n';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
const BODY = read('src/components/OtherCurrenciesSheetBody.tsx');
const RATES = read('src/components/TripRates.tsx');
const SCREEN = read('src/app/group/[id]/settings.tsx');

describe('OtherCurrenciesSheetBody', () => {
  it('draws its own header and the sheet does not double the title', () => {
    expect(BODY).toContain('t.fx.otherCurrencies');
    expect(BODY).toContain('t.fx.otherCurrenciesSubtitleTrip');
    expect(BODY).toContain('t.fx.otherCurrenciesSubtitleGroup');
    expect(BODY).toContain('name="close"');
    const sheet = SCREEN.slice(SCREEN.indexOf('visible={ratesOpen}'));
    expect(sheet.slice(0, sheet.indexOf('</Sheet>'))).not.toContain('title={');
    expect(SCREEN).toContain('<OtherCurrenciesSheetBody');
  });

  it('keeps the rate list on the existing TripRatesCard in card mode', () => {
    expect(BODY).toMatch(/<TripRatesCard\s+embedded\s+cards/);
    expect(RATES).toContain('onEdit={() => setEditing(row.from)}');
    expect(RATES).toContain('t.fx.removeRate');
    expect(RATES).toContain('store.set({ from, num: null, den: null })');
    expect(RATES).toContain("onPress={() => setEditing('')}");
    expect(RATES).toContain('name="ellipsis-vertical"');
  });

  it('leads with the group currency row, and shows the convert switch only while off', () => {
    expect(BODY).toMatch(/<SettlesInRow\s+tile/);
    expect(BODY).toMatch(/convertOn \? null : \(\s*<SettleInCurrencyRow/);
    expect(BODY.indexOf('<SettlesInRow')).toBeLessThan(BODY.indexOf('<TripRatesCard'));
    // Locked: not pressable, no chevron.
    expect(RATES).toContain('disabled={locked}');
    expect(RATES).toContain('{locked ? null : (');
  });

  it('states only what is true about rates, in every language', () => {
    expect(BODY).toContain('t.fx.ratesInfoFetched');
    expect(BODY).toContain('t.fx.ratesInfoKept');
    for (const strings of Object.values(STRINGS_BY_LANGUAGE)) {
      for (const key of [
        'otherCurrenciesSubtitleTrip',
        'otherCurrenciesSubtitleGroup',
        'ratesInfoFetched',
        'ratesInfoKept',
      ] as const) {
        expect(strings.fx[key]).toBeTruthy();
        expect(strings.fx[key].toLowerCase()).not.toContain('automatically');
      }
    }
  });
});
