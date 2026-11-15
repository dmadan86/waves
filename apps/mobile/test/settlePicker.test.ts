import { describe, expect, it } from 'vitest';

import { filterSettleByBalance, filterSettleCandidates } from '../src/lib/settlePicker';
import type { SettleFilter } from '../src/lib/settlePicker';

function candidate(title: string) {
  return { title };
}

describe('filterSettleByBalance', () => {
  const groups = Object.freeze([
    Object.freeze({ title: 'Owed first', balance: 1n }),
    Object.freeze({ title: 'Owe first', balance: -1n }),
    Object.freeze({ title: 'Settled', balance: 0n }),
    Object.freeze({ title: 'Owed second', balance: 9007199254740993n }),
    Object.freeze({ title: 'Owe second', balance: -9007199254740993n }),
  ]);

  it('keeps every balance for all, including zero', () => {
    expect(filterSettleByBalance(groups, 'all')).toEqual(groups);
  });

  it('keeps only positive balances for owed, in their original order', () => {
    expect(filterSettleByBalance(groups, 'owed')).toEqual([groups[0], groups[3]]);
  });

  it('keeps only negative balances for owe, in their original order', () => {
    expect(filterSettleByBalance(groups, 'owe')).toEqual([groups[1], groups[4]]);
  });

  it.each<SettleFilter>(['all', 'owed', 'owe'])('handles empty candidates for %s', (filter) => {
    expect(filterSettleByBalance([], filter)).toEqual([]);
  });

  it('returns no candidates when no balances match', () => {
    expect(filterSettleByBalance([{ balance: 0n }, { balance: -1n }], 'owed')).toEqual([]);
    expect(filterSettleByBalance([{ balance: 0n }, { balance: 1n }], 'owe')).toEqual([]);
  });
});

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
