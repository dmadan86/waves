import { describe, expect, it } from 'vitest';

import { DEFAULT_GROUPS_SORT, filterGroups, sortGroups, type GroupsEntry } from '@/lib/groupsList';

const e = (
  id: string,
  balance: bigint,
  lastActive = 0,
  needsAction = balance !== 0n,
): GroupsEntry => ({ id, label: id, balance, needsAction, lastActive });

const rows = [e('Goa', 500n, 3), e('Flat', -900n, 1), e('Office', 0n, 5), e('Trip', 2000n, 2)];
const ids = (list: readonly GroupsEntry[]) => list.map((r) => r.id);

describe('filterGroups', () => {
  it('keeps everything for All with no query', () => {
    expect(ids(filterGroups(rows, 'all', ''))).toEqual(['Goa', 'Flat', 'Office', 'Trip']);
  });
  it('splits by balance sign', () => {
    expect(ids(filterGroups(rows, 'owed', ''))).toEqual(['Goa', 'Trip']);
    expect(ids(filterGroups(rows, 'owe', ''))).toEqual(['Flat']);
  });
  it('searches by name, ignoring case and padding', () => {
    expect(ids(filterGroups(rows, 'all', '  fl '))).toEqual(['Flat']);
  });
  it('combines the chip and the query', () => {
    expect(ids(filterGroups(rows, 'owed', 'tri'))).toEqual(['Trip']);
  });
});

describe('sortGroups', () => {
  it('defaults to latest activity first', () => {
    expect(DEFAULT_GROUPS_SORT).toBe('recent');
    expect(ids(sortGroups(rows, DEFAULT_GROUPS_SORT))).toEqual(['Office', 'Goa', 'Trip', 'Flat']);
  });

  it('amount: biggest balance first, settled last', () => {
    expect(ids(sortGroups(rows, 'amount'))).toEqual(['Trip', 'Flat', 'Goa', 'Office']);
  });
  it('recent: newest activity first', () => {
    expect(ids(sortGroups(rows, 'recent'))).toEqual(['Office', 'Goa', 'Trip', 'Flat']);
  });
  it('name: alphabetical', () => {
    expect(ids(sortGroups(rows, 'name', 'en'))).toEqual(['Flat', 'Goa', 'Office', 'Trip']);
  });
});
