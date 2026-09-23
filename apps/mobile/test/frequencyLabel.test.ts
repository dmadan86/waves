/**
 * A repeat pattern in words: one label per cadence, and the open-ended one
 * names its own interval instead of a vaguer "every few months".
 */

import { describe, expect, it, vi } from 'vitest';

import { Frequency } from '@waves/core';

import type { UiStrings } from '@/i18n';

import { frequencyLabel } from '../src/lib/frequencyLabel';

vi.mock('@/i18n', () => ({
  fill: (template: string, values: Record<string, string>) =>
    template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match),
}));

const t = {
  personal: {
    weekly: 'Weekly',
    fortnightly: 'Every 2 weeks',
    twiceAMonth: 'Twice a month',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    halfYearly: 'Every 6 months',
    yearly: 'Yearly',
    monthsInterval: 'Every {n} months',
  },
} as unknown as UiStrings;

describe('frequencyLabel', () => {
  it.each([
    [Frequency.Weekly, 'Weekly'],
    [Frequency.Fortnightly, 'Every 2 weeks'],
    [Frequency.TwiceAMonth, 'Twice a month'],
    [Frequency.Monthly, 'Monthly'],
    [Frequency.Quarterly, 'Quarterly'],
    [Frequency.HalfYearly, 'Every 6 months'],
    [Frequency.Yearly, 'Yearly'],
  ])('says %s as "%s"', (frequency, label) => {
    expect(frequencyLabel(t, frequency, 1)).toBe(label);
  });

  it('names the interval of an every-N-months rule', () => {
    expect(frequencyLabel(t, Frequency.EveryNMonths, 5)).toBe('Every 5 months');
  });

  it('reads an unknown pattern as monthly, the default cadence', () => {
    expect(frequencyLabel(t, 'fortnightlyish' as Frequency, 1)).toBe('Monthly');
  });
});
