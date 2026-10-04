import { describe, expect, it } from 'vitest';

import { estimateChipWidth, fitChips } from '@/lib/chipFit';

describe('fitChips', () => {
  const labels = ['$120.50', '€40', 'AED 300', '¥5,000', '£9'];

  it('draws nothing for no chips', () => {
    expect(fitChips([], 200)).toEqual({ shown: 0, hidden: 0 });
  });

  it('draws everything when it fits', () => {
    expect(fitChips(labels.slice(0, 2), 400)).toEqual({ shown: 2, hidden: 0 });
  });

  it('caps at max and counts the rest as hidden', () => {
    expect(fitChips(labels, 1000, 3)).toEqual({ shown: 3, hidden: 2 });
  });

  it('leaves room for the +N chip', () => {
    const w = (s: string): number => estimateChipWidth(s);
    const avail = w(labels[0]!) + 4 + w(labels[1]!) + 4 + w('+3');
    expect(fitChips(labels, avail)).toEqual({ shown: 2, hidden: 3 });
  });

  it('always accounts for every label', () => {
    for (let avail = 0; avail < 300; avail += 7) {
      const { shown, hidden } = fitChips(labels, avail);
      expect(shown + hidden).toBe(labels.length);
    }
  });

  it('shows only +N when no chip fits beside it', () => {
    const avail = estimateChipWidth('+5');
    expect(fitChips(labels, avail)).toEqual({ shown: 0, hidden: 5 });
  });

  it('draws nothing when even +N does not fit', () => {
    expect(fitChips(labels, 5)).toEqual({ shown: 0, hidden: 5 });
  });
});
