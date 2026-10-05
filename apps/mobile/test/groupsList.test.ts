import { describe, expect, it } from 'vitest';

import { filterGroups, sortGroups, type GroupsEntry } from '@/lib/groupsList';

const e = (
  id: string,
  balance: bigint,
  lastActive = 0,
  needsAction = balance !== 0n,
): GroupsEntry => ({ id, label: id, balance, needsAction, lastActive });

const rows = [e('Goa', 500n, 3), e('Flat', -900n, 1), e('Office', 0n, 5), e('Trip', 2000n, 2)];
const none = () => false;
const ids = (list: readonly GroupsEntry[]) => list.map((r) => r.id);

describe('filterGroups', () => {
  it('keeps everything for All with no query', () => {
    expect(ids(filterGroups(rows, 'all', '', none))).toEqual(['Goa', 'Flat', 'Office', 'Trip']);
  });
  it('splits by balance sign', () => {
    expect(ids(filterGroups(rows, 'owed', '', none))).toEqual(['Goa', 'Trip']);
    expect(ids(filterGroups(rows, 'owe', '', none))).toEqual(['Flat']);
  });
  it('keeps only favorites', () => {
    expect(ids(filterGroups(rows, 'favorites', '', (r) => r.id === 'Office'))).toEqual(['Office']);
  });
  it('searches by name, ignoring case and padding', () => {
    expect(ids(filterGroups(rows, 'all', '  fl ', none))).toEqual(['Flat']);
  });
  it('combines the chip and the query', () => {
    expect(ids(filterGroups(rows, 'owed', 'tri', none))).toEqual(['Trip']);
  });
});

describe('sortGroups', () => {
  it('amount: biggest balance first, settled last', () => {
    expect(ids(sortGroups(rows, 'amount', none))).toEqual(['Trip', 'Flat', 'Goa', 'Office']);
  });
  it('recent: newest activity first', () => {
    expect(ids(sortGroups(rows, 'recent', none))).toEqual(['Office', 'Goa', 'Trip', 'Flat']);
  });
  it('name: alphabetical', () => {
    expect(ids(sortGroups(rows, 'name', none, 'en'))).toEqual(['Flat', 'Goa', 'Office', 'Trip']);
  });
  it('puts favorites in front under every sort', () => {
    const fav = (r: GroupsEntry) => r.id === 'Office';
    expect(ids(sortGroups(rows, 'amount', fav))[0]).toBe('Office');
    expect(ids(sortGroups(rows, 'name', fav, 'en'))[0]).toBe('Office');
  });
});
