import { describe, expect, it } from 'vitest';

import { GroupType } from '../src/data/types';
import {
  arrangeSettleCandidates,
  chipGroupTypes,
  filterSettleCandidates,
  matchesSettleChip,
  sortSettleCandidates,
} from '../src/lib/settlePicker';

function candidate(
  title: string,
  extra: Partial<{
    type: GroupType;
    balance: bigint;
    lastActivityAt: number;
    isAdmin: boolean;
  }> = {},
) {
  return {
    id: title,
    title,
    coverEmoji: null,
    photoPath: null,
    balance: 1000n,
    currency: 'INR',
    memberCount: 2,
    lastActivityAt: 0,
    type: GroupType.Other,
    isAdmin: false,
    ...extra,
  };
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

describe('chip mapping', () => {
  it('maps type chips onto group types', () => {
    expect(chipGroupTypes('all')).toBeNull();
    expect(chipGroupTypes('trips')).toEqual([GroupType.Trip]);
    expect(chipGroupTypes('family')).toEqual([GroupType.Home, GroupType.Couple]);
    expect(chipGroupTypes('friends')).toEqual([GroupType.Friends]);
  });

  it('matches by type, and "yours" by admin role', () => {
    const trip = candidate('T', { type: GroupType.Trip });
    const couple = candidate('C', { type: GroupType.Couple, isAdmin: true });
    expect(matchesSettleChip(trip, 'all')).toBe(true);
    expect(matchesSettleChip(trip, 'trips')).toBe(true);
    expect(matchesSettleChip(trip, 'family')).toBe(false);
    expect(matchesSettleChip(couple, 'family')).toBe(true);
    expect(matchesSettleChip(couple, 'yours')).toBe(true);
    expect(matchesSettleChip(trip, 'yours')).toBe(false);
  });
});

describe('sortSettleCandidates', () => {
  const a = candidate('Bravo', { balance: -500n, lastActivityAt: 10 });
  const b = candidate('Alpha', { balance: 300n, lastActivityAt: 30 });
  const c = candidate('Charlie', { balance: 900n, lastActivityAt: 20 });

  it('orders by biggest balance either way', () => {
    expect(sortSettleCandidates([a, b, c], 'balance')).toEqual([c, a, b]);
  });
  it('orders by latest activity', () => {
    expect(sortSettleCandidates([a, b, c], 'recent')).toEqual([b, c, a]);
  });
  it('orders by name', () => {
    expect(sortSettleCandidates([a, b, c], 'name', 'en')).toEqual([b, a, c]);
  });
  it('does not mutate its input', () => {
    const input = [a, b, c];
    sortSettleCandidates(input, 'name');
    expect(input).toEqual([a, b, c]);
  });
});

describe('arrangeSettleCandidates', () => {
  it('applies search, chip and sort together', () => {
    const groups = [
      candidate('Goa trip', { type: GroupType.Trip, balance: 100n }),
      candidate('Goa flat', { type: GroupType.Home, balance: 200n }),
      candidate('Sapa trip', { type: GroupType.Trip, balance: 300n }),
    ];
    const out = arrangeSettleCandidates(groups, { query: 'goa', chip: 'trips', sort: 'balance' });
    expect(out.map((g) => g.title)).toEqual(['Goa trip']);
    expect(
      arrangeSettleCandidates(groups, { query: '', chip: 'all', sort: 'balance' }).map(
        (g) => g.title,
      ),
    ).toEqual(['Sapa trip', 'Goa flat', 'Goa trip']);
  });
});
