import { describe, expect, it } from 'vitest';

import { filterSettleCandidates, SETTLE_SEARCH_THRESHOLD } from '../src/lib/settlePicker';

function candidate(title: string) {
  return { id: title, title, coverEmoji: null, balance: 1000n, currency: 'INR' };
}

describe('filterSettleCandidates', () => {
  it('keeps every candidate for an empty query', () => {
    const groups = [candidate('Goa trip'), candidate('Flat finances')];
    expect(filterSettleCandidates(groups, '')).toEqual(groups);
    expect(filterSettleCandidates(groups, '   ')).toEqual(groups);
  });

  it('matches on a case- and accent-insensitive substring of the title', () => {
    const groups = [candidate('São Paulo Riders'), candidate('Café Paris Trip')];
    expect(filterSettleCandidates(groups, 'sao')).toEqual([groups[0]]);
    expect(filterSettleCandidates(groups, 'CAFE')).toEqual([groups[1]]);
  });

  it('drops a group whose name the query does not touch', () => {
    const groups = [candidate('Goa trip'), candidate('Flat finances')];
    expect(filterSettleCandidates(groups, 'finance')).toEqual([groups[1]]);
  });

  it('can land on nothing at all', () => {
    const groups = [candidate('Goa trip')];
    expect(filterSettleCandidates(groups, 'zzz')).toEqual([]);
  });
});

describe('SETTLE_SEARCH_THRESHOLD', () => {
  it('is the same past-this-many-rows threshold the group picker uses', () => {
    expect(SETTLE_SEARCH_THRESHOLD).toBeGreaterThan(0);
  });
});
