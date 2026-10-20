import { currencySymbol } from '@waves/core';
import { describe, expect, it } from 'vitest';

import {
  arcPath,
  compactNumber,
  donutSlices,
  niceTicks,
  percentChange,
  monthRange,
  previousMonthKey,
  selectableMonth,
  smoothPath,
} from '../src/lib/spendingChart';

describe('compactNumber', () => {
  it('abbreviates thousands and millions without trailing zeros', () => {
    expect(compactNumber(112009.92)).toBe('112K');
    expect(compactNumber(71200)).toBe('71.2K');
    expect(compactNumber(32000)).toBe('32K');
    expect(compactNumber(1250000)).toBe('1.25M');
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(850)).toBe('850');
  });
});

describe('niceTicks', () => {
  it('climbs in round steps to at least the maximum', () => {
    expect(niceTicks(71200)).toEqual([0, 20000, 40000, 60000, 80000]);
    expect(niceTicks(112009)).toEqual([0, 50000, 100000, 150000]);
  });
  it('survives an empty chart', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe('donutSlices', () => {
  it('sizes slices against the whole total and rounds the percentages', () => {
    const slices = donutSlices(
      [
        { item: 'a', value: 71 },
        { item: 'b', value: 19 },
      ],
      100,
    );
    expect(slices.map((s) => s.percent)).toEqual([71, 19]);
    expect(slices[1]!.start).toBeCloseTo(slices[0]!.end);
    expect(donutSlices([], 0)).toEqual([]);
  });
});

describe('paths', () => {
  it('draws an arc and a curve', () => {
    expect(arcPath(50, 50, 40, 0, Math.PI / 2)).toMatch(/^M 50 10 A 40 40 0 0 1 90 50/);
    const d = smoothPath(
      [
        { x: 0, y: 10 },
        { x: 10, y: 0 },
        { x: 20, y: 5 },
      ],
      10,
    );
    expect(d.startsWith('M 0 10 C')).toBe(true);
    expect(smoothPath([], 0)).toBe('');
  });
});

describe('percentChange', () => {
  it('compares with the month before, and says nothing when there is none', () => {
    expect(percentChange(112n, 100n)).toBe(12);
    expect(percentChange(80n, 100n)).toBe(-20);
    expect(percentChange(80n, null)).toBeNull();
    expect(percentChange(80n, 0n)).toBeNull();
  });
});

describe('previousMonthKey', () => {
  it('steps back across a year boundary', () => {
    expect(previousMonthKey('2026-09-01')).toBe('2026-08-01');
    expect(previousMonthKey('2026-01-01')).toBe('2025-12-01');
  });
});

describe('monthRange', () => {
  it('lists consecutive months ending at the last one', () => {
    expect(monthRange('2026-02-01', 3)).toEqual(['2025-12-01', '2026-01-01', '2026-02-01']);
  });
});

describe('selectableMonth', () => {
  const spending = ['2026-08-01', '2026-10-01'];
  it('keeps an empty month the chart offers, instead of showing the latest', () => {
    expect(selectableMonth('2026-09-01', '2026-10-01', spending)).toBe('2026-09-01');
  });
  it('falls back to the latest for a month outside the chart, and for none', () => {
    expect(selectableMonth('2020-01-01', '2026-10-01', spending)).toBe('2026-10-01');
    expect(selectableMonth(null, '2026-10-01', spending)).toBe('2026-10-01');
    expect(selectableMonth('2026-09-01', null, [])).toBeNull();
  });
});

describe('currencySymbol in Arabic', () => {
  it('finds the symbol even where the locale prints it after the digits', () => {
    const symbol = currencySymbol('INR', 'ar');
    expect(symbol.replace(/[\u200e\u200f\u061c\s]/g, '')).not.toBe('');
  });
});
