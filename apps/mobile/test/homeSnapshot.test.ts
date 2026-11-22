import { describe, expect, it } from 'vitest';

import {
  parseSnapshot,
  serialiseSnapshot,
  snapshotKey,
  type HomeSnapshot,
} from '../src/lib/homeSnapshot';

const row = {
  key: 'g1',
  title: 'Goa',
  memberLabel: '3 people',
  amountText: '₹10',
  directionLabel: 'owed',
};
const snap = (viewerId: string): HomeSnapshot => ({
  v: 1,
  viewerId,
  headline: {
    currency: 'INR',
    net: '-500',
    owed: '100',
    owing: '600',
    owedGroups: 1,
    owingGroups: 2,
  },
  needs: [],
  needsTotal: 0,
  comingUp: [],
  personal: row,
  groups: [row],
});

describe('home snapshot', () => {
  it('round-trips for the same account', () => {
    expect(parseSnapshot(serialiseSnapshot(snap('a')), 'a')).toEqual(snap('a'));
  });
  it("never yields another account's snapshot", () => {
    expect(parseSnapshot(serialiseSnapshot(snap('a')), 'b')).toBeNull();
  });
  it('keys storage per account', () => {
    expect(snapshotKey('a')).not.toBe(snapshotKey('b'));
    expect(snapshotKey('a')).toContain('a');
  });
  it('rejects malformed input', () => {
    expect(parseSnapshot(null, 'a')).toBeNull();
    expect(parseSnapshot('{', 'a')).toBeNull();
    const bad = { ...snap('a'), headline: { ...snap('a').headline, net: 'x' } };
    expect(parseSnapshot(JSON.stringify(bad), 'a')).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...snap('a'), groups: [{}] }), 'a')).toBeNull();
  });
});
