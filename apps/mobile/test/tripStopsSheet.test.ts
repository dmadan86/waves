/**
 * Countries visited: the itinerary row in group settings, its one sheet, and
 * what the itinerary decides elsewhere. Source is pinned rather than mounting
 * the native components, the way the Dates sheet is tested; the calendar
 * rules themselves are @waves/core's and tested there.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { StopError } from '@waves/core';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const { STRINGS_BY_LANGUAGE } = await import('../src/i18n');
const { stopErrorText, stopLine } = await import('../src/lib/tripStops');

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');
const SHEET = read('src/components/TripStopsSheet.tsx');
const SETTINGS = read('src/app/group/[id]/settings.tsx');
const ADD = read('src/app/group/[id]/add-expense.tsx');
const INSIGHTS = read('src/app/group/[id]/insights.tsx');
const DATES = read('src/components/DatesSheetBody.tsx');

describe('the Countries visited row', () => {
  it('sits in the settings card only for a trip or an event, under the dates', () => {
    const dates = SETTINGS.indexOf('title={t.extras.datesRow}');
    const stops = SETTINGS.indexOf('title={t.stops.countriesVisited}');
    const hasDatesClose = SETTINGS.indexOf(') : null}', stops);
    expect(dates).toBeGreaterThan(-1);
    expect(stops).toBeGreaterThan(dates);
    // Both rows live inside the one `hasDates ? (…) : null` block.
    expect(SETTINGS.slice(dates, hasDatesClose)).toContain('setStopsOpen(true)');
  });

  it('opens one sheet, mounted only while open, and lets only an admin edit', () => {
    expect(SETTINGS).toMatch(/\{stopsOpen \? \(\s*<TripStopsBody/);
    expect(SETTINGS).toContain('canEdit={isAdmin}');
  });

  it('pins a rate for each new currency only if absent, after the stops save', () => {
    const save = SETTINGS.slice(
      SETTINGS.indexOf('const saveStops'),
      SETTINGS.indexOf('const memberCount'),
    );
    expect(save.indexOf('setTripStops.mutateAsync')).toBeLessThan(save.indexOf('fetchFxRate'));
    expect(save).toContain('ifAbsent: true');
    expect(save).toContain('stopCurrencies(stops, currency)');
  });
});

describe('the stops sheet', () => {
  it('stays one sheet: panes, never a second modal', () => {
    expect(SHEET).not.toContain('<Sheet');
    expect(SHEET).not.toContain('router.push');
    expect(SHEET).toContain("useState<Pane>('list')");
  });

  it('refuses a broken itinerary before queueing it', () => {
    const commit = SHEET.slice(SHEET.indexOf('const commit'), SHEET.indexOf('const saveStop'));
    expect(commit.indexOf('validateStops')).toBeLessThan(commit.indexOf('onSave'));
  });

  it('bounds a stop to the trip dates and never clears one', () => {
    expect(SHEET).toContain('bounds={bounds}');
    expect(SHEET).toContain('canClear={false}');
    expect(DATES).toContain('disabled={outside}');
  });

  it('names each refusal', () => {
    const t = STRINGS_BY_LANGUAGE.en;
    expect(stopErrorText(StopError.Overlap, t)).toBe(t.stops.overlap);
    expect(stopErrorText(StopError.OutsideTrip, t)).toBe(t.stops.outsideTrip);
    expect(stopErrorText(StopError.EndBeforeStart, t)).toBe(t.stops.endBeforeStart);
    expect(stopErrorText(StopError.TooMany, t)).toBe(t.stops.tooMany);
  });

  it('writes a stop line as days and currency', () => {
    expect(stopLine({ country: 'ID', start: '2026-10-01', end: '2026-10-05' }, 'en-GB')).toMatch(
      /Oct.*·\s*IDR$/,
    );
  });
});

describe('what the itinerary decides', () => {
  it('a new bill starts in the stop’s currency, unless one was picked', () => {
    expect(ADD).toContain('const currency = expenseCurrency ?? stopCurrency ?? groupCurrency;');
    expect(ADD).toContain('featured={stopCurrencies(tripStops.data, groupCurrency)}');
  });

  it('Spending shows a By country card only when there are stops', () => {
    expect(INSIGHTS).toContain('tripStops.data.length === 0');
    expect(INSIGHTS).toMatch(/byCountry\.length > 0 \? \(\s*<ByCountryCard/);
  });
});

describe('strings', () => {
  it('exist in every language', () => {
    for (const strings of Object.values(STRINGS_BY_LANGUAGE)) {
      const keys = Object.keys(strings.stops);
      expect(keys).toEqual(Object.keys(STRINGS_BY_LANGUAGE.en.stops));
      expect(strings.stops.whenThere).toContain('{country}');
      expect(strings.stops.byCountryCaption).toContain('{currency}');
      expect(strings.stops.currencyPinned).toContain('{currency}');
    }
  });
});
