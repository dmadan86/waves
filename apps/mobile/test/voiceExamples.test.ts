import { describe, expect, it } from 'vitest';

import { exampleCountry, voiceExamples } from '@/lib/voiceExamples';

/** A fixed sequence of draws, cycling. */
const draws =
  (...values: number[]) =>
  () => {
    const value = values.shift() ?? 0;
    values.push(value);
    return value;
  };

describe('voiceExamples', () => {
  it('fits the place, names and amounts to the country', () => {
    const india = voiceExamples('IN', [], draws(0));
    expect(india.place).toBe('Goa');
    expect(india.names).toEqual(['Ravi', 'Priya']);
    expect([india.groceries, india.dinner, india.coffee]).toEqual(['850', '1,200', '180']);

    const us = voiceExamples('us', [], draws(0));
    expect(us.place).toBe('Yosemite');
    expect(us.names).toEqual(['Mike', 'Sarah']);
    expect([us.groceries, us.dinner, us.coffee]).toEqual(['85', '120', '6']);
  });

  it('draws a different place and pair as the random source moves', () => {
    const later = voiceExamples('IN', [], draws(0.99));
    expect(later.place).toBe('Pondicherry');
    expect(later.names).toEqual(['Rahul', 'Sneha']);
  });

  it("uses one of the reader's own groups when there are any", () => {
    const set = voiceExamples('IN', ['  Flatmates ', 'Goa 2026'], draws(0.9));
    expect(set.group).toBe('Goa 2026');
    expect(voiceExamples('IN', ['', '  '], draws(0)).group).toBeNull();
  });

  it('falls back to a neutral set for an unknown or missing country', () => {
    for (const country of [null, 'ZZ']) {
      const set = voiceExamples(country, [], draws(0));
      expect(set.place).toBe('Beach');
      expect(set.names).toEqual(['Alex', 'Sam']);
    }
  });

  it('groups thousands the way the parser reads them', () => {
    const lanka = voiceExamples('LK', [], draws(0));
    expect([lanka.groceries, lanka.dinner, lanka.coffee]).toEqual(['4,500', '6,000', '900']);
  });
});

describe('exampleCountry', () => {
  it('follows the currency before the phone region', () => {
    expect(exampleCountry('INR', 'US')).toBe('IN');
    expect(exampleCountry('aed', null)).toBe('AE');
  });

  it('shares the euro by the phone country, Germany by default', () => {
    expect(exampleCountry('EUR', 'FR')).toBe('FR');
    expect(exampleCountry('EUR', 'US')).toBe('DE');
  });

  it('falls back to the phone country for a currency it does not know', () => {
    expect(exampleCountry('JPY', 'JP')).toBe('JP');
    expect(exampleCountry(null, null)).toBeNull();
  });
});
