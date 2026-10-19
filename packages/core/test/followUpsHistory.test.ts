import { describe, expect, it } from 'vitest';

import {
  buildHistoryStats,
  EMPTY_HISTORY,
  medianOf,
  type HistoryRecord,
} from '../src/voice/followUps';

const record = (over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  scope: 'personal',
  amountMinor: 100n,
  currency: 'INR',
  category: 'food',
  description: 'Dinner',
  date: '2026-10-21',
  partners: [],
  place: null,
  at: '2026-10-21',
  ...over,
});
const anu = { memberId: 'm-anu', groupId: 'g-goa', name: 'Anu' };
const ravi = { memberId: 'm-ravi', groupId: 'g-goa', name: 'Ravi' };

describe('history statistics', () => {
  it('HS-01 medians sort odd/even bigint samples and floor an odd sum', () => {
    const samples = [9n, 1n, 3n];
    expect(medianOf(samples)).toBe(3n);
    expect(samples).toEqual([9n, 1n, 3n]);
    expect(medianOf([4n, 1n])).toBe(2n);
    expect(medianOf([9007199254740993n, 9007199254740996n])).toBe(9007199254740994n);
    expect(medianOf([])).toBeNull();
  });
  it('HS-02 currencies use separate case-insensitive buckets', () => {
    expect(
      buildHistoryStats([
        record(),
        record({ currency: 'inr', amountMinor: 300n }),
        record({ currency: 'GBP', amountMinor: 9n }),
      ]).byCurrency,
    ).toEqual({ INR: { median: 200n, count: 2 }, GBP: { median: 9n, count: 1 } });
  });
  it('HS-03 partners count per category and sort by count then name', () => {
    const stats = buildHistoryStats([
      record({ partners: [ravi, anu] }),
      record({ partners: [ravi] }),
      record({ partners: [{ ...anu, memberId: 'm-sam', name: 'Sam' }] }),
      record({ category: 'travel', partners: [anu] }),
    ]);
    expect(stats.partnersByCategory.food).toEqual([
      { ...ravi, count: 2 },
      { ...anu, count: 1 },
      { ...anu, memberId: 'm-sam', name: 'Sam', count: 1 },
    ]);
    expect(stats.partnersByCategory.travel).toEqual([{ ...anu, count: 1 }]);
  });
  it('HS-04 places are newest first, trimmed, deduped and capped at eight', () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      record({ at: `2026-10-${String(i + 1).padStart(2, '0')}`, place: `Place ${i}` }),
    );
    records.push(record({ at: '2026-10-21', place: ' Place 9 ' }));
    expect(buildHistoryStats(records).recentPlaces).toEqual([
      'Place 9',
      'Place 8',
      'Place 7',
      'Place 6',
      'Place 5',
      'Place 4',
      'Place 3',
      'Place 2',
    ]);
  });
  it('HS-05 categories sort by frequency then name', () => {
    expect(
      buildHistoryStats([
        record({ category: 'travel' }),
        record({ category: 'Food' }),
        record({ category: 'food' }),
        record({ category: 'home' }),
        record({ category: null }),
      ]).topCategories,
    ).toEqual(['food', 'home', 'travel']);
  });
  it('HS-06 pastPersonal includes only personal records', () => {
    expect(
      buildHistoryStats([record(), record({ scope: 'group', description: 'Group dinner' })])
        .pastPersonal,
    ).toEqual([{ description: 'Dinner', amountMinor: 100n, currency: 'INR', date: '2026-10-21' }]);
  });
  it('HS-07 extras default to empty and provided extras survive', () => {
    expect(buildHistoryStats([])).toEqual(EMPTY_HISTORY);
    const trips = [
      { groupId: 'g-goa', name: 'Goa trip', startDate: null, endDate: null, quietDays: 5 },
    ];
    expect(buildHistoryStats([], { trips, recurringRules: ['rent'] })).toMatchObject({
      trips,
      recurringRules: ['rent'],
      recentGroupExpenses: [],
    });
  });
});
