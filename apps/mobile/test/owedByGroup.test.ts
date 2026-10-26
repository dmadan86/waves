import { describe, expect, it } from 'vitest';
import { owedByGroup, viewerEdge, type OwedContribution } from '../src/lib/owedByGroup';
import { detectBalanceQuery, detectOwedDirection } from '../src/lib/voiceExpense';

const groups = [
  { groupId: 'trip', groupName: 'Trip', coverEmoji: '🏖️' },
  { groupId: 'home', groupName: 'Home', coverEmoji: '🏠' },
];
const contribution = (
  groupId: string,
  memberId: string,
  net: bigint,
  currency = 'INR',
): OwedContribution => ({ groupId, memberId, displayName: memberId, currency, net });

describe('owedByGroup', () => {
  it('groups people and totals by group, retaining group identity', () => {
    const result = owedByGroup(
      [
        contribution('trip', 'Matt', 1200n),
        contribution('trip', 'Sam', 300n),
        contribution('home', 'Matt', 200n),
        contribution('home', 'Alex', -500n),
        contribution('home', 'Zero', 0n),
      ],
      groups,
      'owed',
    );
    expect(result.rows).toEqual([
      {
        ...groups[0],
        currency: 'INR',
        people: [
          { name: 'Matt', amount: 1200n },
          { name: 'Sam', amount: 300n },
        ],
        total: 1500n,
      },
      { ...groups[1], currency: 'INR', people: [{ name: 'Matt', amount: 200n }], total: 200n },
    ]);
    expect(result.totals).toEqual([{ currency: 'INR', total: 1700n }]);
  });

  it('excludes edges between other members using the shared viewer filter', () => {
    const edges = [
      { from: 'Matt', to: 'me', amount: 100n },
      { from: 'Matt', to: 'Sam', amount: 900n },
      { from: 'me', to: 'Sam', amount: 200n },
    ];
    const contributions = edges.flatMap((edge) => {
      const oriented = viewerEdge(edge, 'me');
      return oriented ? [contribution('trip', oriented.otherId, oriented.net)] : [];
    });
    expect(owedByGroup(contributions, groups, 'owed').totals).toEqual([
      { currency: 'INR', total: 100n },
    ]);
    expect(owedByGroup(contributions, groups, 'owe').rows[0]?.people).toEqual([
      { name: 'Sam', amount: 200n },
    ]);
  });

  it('uses absolute negative balances for owe and ignores positive balances', () => {
    const result = owedByGroup(
      [contribution('trip', 'Matt', -250n), contribution('trip', 'Sam', 100n)],
      groups,
      'owe',
    );
    expect(result.rows[0]?.total).toBe(250n);
    expect(result.totals).toEqual([{ currency: 'INR', total: 250n }]);
  });

  it('keeps currencies separate within a group and across grand totals', () => {
    const result = owedByGroup(
      [
        contribution('trip', 'Matt', 100n),
        contribution('trip', 'Sam', 200n, 'USD'),
        contribution('home', 'Matt', 300n, 'USD'),
      ],
      groups,
      'owed',
    );
    expect(
      result.rows.map(({ groupId, currency, total }) => ({ groupId, currency, total })),
    ).toEqual([
      { groupId: 'trip', currency: 'INR', total: 100n },
      { groupId: 'trip', currency: 'USD', total: 200n },
      { groupId: 'home', currency: 'USD', total: 300n },
    ]);
    expect(result.totals).toEqual([
      { currency: 'INR', total: 100n },
      { currency: 'USD', total: 500n },
    ]);
    expect(owedByGroup([], groups, 'owed')).toEqual({ rows: [], totals: [] });
  });
});

describe('detectOwedDirection', () => {
  it('recognizes overall owed and owe questions as balance queries', () => {
    for (const text of ['who owes me?', 'what am I owed', 'how much am I owed overall']) {
      expect(detectOwedDirection(text)).toBe('owed');
      expect(detectBalanceQuery(text)).toEqual({ kind: 'balance' });
    }
    for (const text of ['who do I owe', 'what do I owe?', 'how much do I owe overall']) {
      expect(detectOwedDirection(text)).toBe('owe');
      expect(detectBalanceQuery(text)).toEqual({ kind: 'balance' });
    }
  });
  it('leaves named people, named groups, and unrelated questions alone', () => {
    for (const text of [
      'how much do I owe Matt',
      'who owes me in Goa',
      'what is my balance',
      'what am I owed for lunch',
      'add 500 to Goa',
    ])
      expect(detectOwedDirection(text)).toBeNull();
    expect(detectBalanceQuery('how much do I owe Matt')).toEqual({ kind: 'person', who: 'Matt' });
  });
});
