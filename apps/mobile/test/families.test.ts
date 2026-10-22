import { describe, expect, it } from 'vitest';

import { familyStatement, type GroupUnits, type NetBalances } from '@waves/core';

import {
  createFamily,
  familyBalanceItems,
  familyEmoji,
  familyLabel,
  familyOf,
  familyRows,
  familyTransfers,
  hasFamilies,
  placeMember,
  warningTransfers,
  withFamily,
} from '../src/lib/families';
import { editStateFromVersion, splitKindOf, splitParamsFor } from '../src/lib/expenseEdit';
import { SplitKind } from '../src/lib/split';
import type { ExpenseVersionRow } from '../src/data/types';

const UNITS: GroupUnits = {
  sharma: { name: 'Sharma family', members: ['ravi', 'priya', 'anu'], head: 'priya' },
  patel: { name: 'Patel family', members: ['sam', 'meera'] },
};
const m = (id: string, left_at: string | null = null) => ({ id, left_at });
const MEMBERS = [m('ravi'), m('priya'), m('anu'), m('sam'), m('meera'), m('zara'), m('bo')];

describe('family rows and balances', () => {
  it('lists families with their members, then everyone on their own', () => {
    const { families, onTheirOwn } = familyRows(UNITS, MEMBERS);
    expect(families.map((f) => [f.id, f.members.map((x) => x.id)])).toEqual([
      ['sharma', ['ravi', 'priya', 'anu']],
      ['patel', ['sam', 'meera']],
    ]);
    expect(onTheirOwn.map((x) => x.id)).toEqual(['zara', 'bo']);
    expect(hasFamilies(UNITS)).toBe(true);
    expect(hasFamilies(null)).toBe(false);
    expect(familyOf(UNITS, 'anu')?.name).toBe('Sharma family');
    expect(familyOf(UNITS, 'zara')).toBeNull();
  });

  it('adds a family’s balances up and leaves singles as they are', () => {
    const balances = new Map([
      ['ravi', 500n],
      ['priya', -200n],
      ['anu', 100n],
      ['sam', -300n],
      ['zara', -100n],
    ]);
    // A departed member with no balance is already filtered out by the tab.
    const items = familyBalanceItems(
      UNITS,
      MEMBERS.filter((x) => x.id !== 'meera'),
      balances,
    );
    expect(items).toMatchObject([
      { kind: 'family', id: 'sharma', balance: 400n },
      { kind: 'family', id: 'patel', balance: -300n },
      { kind: 'person', member: { id: 'zara' }, balance: -100n },
      { kind: 'person', member: { id: 'bo' }, balance: 0n },
    ]);
  });

  it('names the viewer for their own family, so anyone in it can record the payment', () => {
    const net: NetBalances = new Map([
      [
        'INR',
        new Map([
          ['ravi', 500n],
          ['priya', -200n],
          ['anu', 100n],
          ['sam', -300n],
          ['meera', 0n],
          ['zara', -100n],
        ]),
      ],
    ]);
    // Meera is in the paying Patel family but not its head: the line is hers to record.
    expect(familyTransfers(net, UNITS, 'meera')).toEqual([
      { from: 'meera', to: 'priya', currency: 'INR', amount: 300n },
      { from: 'zara', to: 'priya', currency: 'INR', amount: 100n },
    ]);
    // Anu is in the receiving Sharma family: both lines come to her.
    expect(familyTransfers(net, UNITS, 'anu').map((x) => x.to)).toEqual(['anu', 'anu']);
    // Somebody on their own is unchanged.
    expect(familyTransfers(net, UNITS, 'zara')).toEqual(familyTransfers(net, UNITS));
  });

  it('settles family to family, said as the two heads', () => {
    const net: NetBalances = new Map([
      [
        'INR',
        new Map([
          ['ravi', 500n],
          ['priya', -200n],
          ['anu', 100n],
          ['sam', -300n],
          ['meera', 0n],
          ['zara', -100n],
        ]),
      ],
    ]);
    const transfers = familyTransfers(net, UNITS);
    // Sharma +400, Patel −300, zara −100 → Patel pays Sharma 300, zara pays Sharma 100.
    const statement = familyStatement(
      { name: 'Trip', currency: 'INR' },
      UNITS,
      'sharma',
      [
        {
          id: 'bill',
          description: 'Dinner',
          date: '2026-10-22',
          currency: 'INR',
          amount: 600n,
          payers: { ravi: 500n, anu: 100n },
          shares: { priya: 200n, sam: 300n, zara: 100n },
        },
      ],
      [],
    );
    expect(statement.transfers).toEqual(transfers);
    expect(transfers).toEqual([
      { from: 'sam', to: 'priya', currency: 'INR', amount: 300n },
      { from: 'zara', to: 'priya', currency: 'INR', amount: 100n },
    ]);
    expect(familyLabel(UNITS, 'priya', 'Priya')).toBe('Sharma family (Priya)');
    expect(familyLabel(UNITS, 'zara', 'Zara')).toBe('Zara');
  });
});

describe('warningTransfers', () => {
  const inr = (pairs: [string, bigint][]): NetBalances => new Map([['INR', new Map(pairs)]]);
  const t = (from: string, to: string, amount: bigint) => ({ from, to, currency: 'INR', amount });

  it('never names nothing while the group is not square', () => {
    // Ravi owes Priya inside the Sharma family: family netting hides it.
    const ledger = {
      net: inr([
        ['ravi', -1000n],
        ['priya', 1000n],
      ]),
      transfers: [t('ravi', 'priya', 1000n)],
      groupSettled: false,
    };
    expect(warningTransfers(ledger, UNITS)).toEqual([t('ravi', 'priya', 1000n)]);
  });

  it('lists the family lines and the intra-family debts together', () => {
    const ledger = {
      net: inr([
        ['ravi', -1000n],
        ['priya', 1300n],
        ['sam', -300n],
      ]),
      transfers: [t('sam', 'priya', 300n), t('ravi', 'priya', 1000n)],
      groupSettled: false,
    };
    expect(warningTransfers(ledger, UNITS)).toEqual([
      t('sam', 'priya', 300n),
      t('ravi', 'priya', 1000n),
    ]);
  });

  it('is empty for a square group', () => {
    expect(warningTransfers({ net: inr([]), transfers: [], groupSettled: true }, UNITS)).toEqual(
      [],
    );
  });
});

describe('editing families', () => {
  it('creates a family out of people already in other families', () => {
    const next = createFamily(UNITS, 'new', 'Newlyweds', ['priya', 'sam']);
    expect(next?.new).toEqual({ name: 'Newlyweds', members: ['priya', 'sam'] });
    expect(next?.sharma).toEqual({ name: 'Sharma family', members: ['ravi', 'anu'], head: 'ravi' });
    expect(next?.patel?.members).toEqual(['meera']);
    expect(createFamily(null, 'solo', 'Solo', ['zara'])).toEqual({
      solo: { name: 'Solo', members: ['zara'] },
    });
  });

  it('moves a member between families, re-heading a family whose head left', () => {
    const moved = placeMember(UNITS, 'priya', 'patel');
    expect(moved?.sharma).toEqual({
      name: 'Sharma family',
      members: ['ravi', 'anu'],
      head: 'ravi',
    });
    expect(moved?.patel?.members).toEqual(['sam', 'meera', 'priya']);
    const alone = placeMember(moved, 'priya', null);
    expect(alone?.patel?.members).toEqual(['sam', 'meera']);
    // The last member out deletes the family.
    const gone = placeMember(placeMember(UNITS, 'sam', null), 'meera', null);
    expect(gone?.patel).toBeUndefined();
    expect(withFamily({ only: { name: 'x', members: ['a'] } }, 'only', null)).toBeNull();
  });
});

describe('a malformed families map', () => {
  it('reads as families with nobody in them rather than crashing', () => {
    const bad = {
      u: {},
      v: null,
      w: { name: 'Odd', members: 'ravi' },
      ok: { name: 'Patel family', members: ['sam', 3, 'meera'] },
    } as unknown as GroupUnits;
    const { families, onTheirOwn } = familyRows(bad, MEMBERS);
    expect(families.map((f) => [f.id, f.members.map((x) => x.id)])).toEqual([
      ['ok', ['sam', 'meera']],
    ]);
    expect(onTheirOwn.map((x) => x.id)).toEqual(['ravi', 'priya', 'anu', 'zara', 'bo']);
    expect(familyOf(bad, 'ravi')).toBeNull();
    expect(familyBalanceItems(bad, MEMBERS, new Map([['sam', 5n]]))[0]).toMatchObject({
      kind: 'family',
      id: 'ok',
      balance: 5n,
    });
    expect(placeMember(bad, 'zara', 'u')?.u).toEqual({ members: ['zara'] });
  });
});

describe('split by family in the editor', () => {
  const base = {
    weights: {},
    percents: {},
    exacts: {},
    currency: 'INR',
    participants: ['ravi', 'anu', 'zara'],
  };

  it('snapshots the families onto an equal split, and only an equal one', () => {
    expect(splitParamsFor({ ...base, splitKind: SplitKind.Equal, byFamily: UNITS })).toEqual({
      kind: 'units',
      units: { sharma: ['ravi', 'anu'], zara: ['zara'] },
    });
    expect(splitParamsFor({ ...base, splitKind: SplitKind.Equal, byFamily: null })).toEqual({
      kind: 'equal',
    });
    expect(
      splitParamsFor({
        ...base,
        splitKind: SplitKind.Shares,
        byFamily: UNITS,
        weights: { ravi: '1' },
      }).kind,
    ).toBe('shares');
  });

  it('keeps a saved by-family bill’s own composition until the split is touched', () => {
    const saved = { kind: 'units', units: { fam: ['anu', 'ravi'], zara: ['zara'] } } as const;
    const version = {
      amount: '300',
      currency: 'INR',
      description: 'Dinner',
      expense_date: '2026-10-25',
      split_type: 'units',
      split_params: saved,
      payers: [{ member_id: 'zara', amount: '300' }],
      shares: [
        { member_id: 'anu', amount: '75' },
        { member_id: 'ravi', amount: '75' },
        { member_id: 'zara', amount: '150' },
      ],
    } as unknown as ExpenseVersionRow;
    const state = editStateFromVersion(version, null);
    expect(state.splitKind).toBe(SplitKind.Equal);
    expect(state.savedUnits).toEqual(saved);
    // Flag off (no families offered) and families since changed: still the bill's own.
    expect(splitParamsFor({ ...state, byFamily: null })).toEqual(saved);
    expect(splitParamsFor({ ...state, byFamily: UNITS })).toEqual(saved);
    // The split touched: rebuilt from today's families, or per person.
    expect(splitParamsFor({ ...state, savedUnits: null, byFamily: UNITS })).toEqual({
      kind: 'units',
      units: { sharma: ['ravi', 'anu'], zara: ['zara'] },
    });
    expect(splitParamsFor({ ...state, savedUnits: null, byFamily: null })).toEqual({
      kind: 'equal',
    });
  });

  it('reopens a by-family bill as equal and an unknown kind as exact from the saved shares', () => {
    expect(splitKindOf('units')).toBe(SplitKind.Equal);
    expect(splitKindOf('something_new')).toBe(SplitKind.Exact);
    const version = {
      amount: '300',
      currency: 'INR',
      description: 'Dinner',
      expense_date: '2026-10-25',
      split_type: 'something_new',
      split_params: { kind: 'something_new' },
      payers: [{ member_id: 'ravi', amount: '300' }],
      shares: [
        { member_id: 'ravi', amount: '100' },
        { member_id: 'anu', amount: '200' },
      ],
    } as unknown as ExpenseVersionRow;
    const state = editStateFromVersion(version, null);
    expect(state.splitKind).toBe(SplitKind.Exact);
    expect(state.exacts).toEqual({ ravi: '1.00', anu: '2.00' });
    expect(state.participants).toEqual(['ravi', 'anu']);
  });
});

describe('familyEmoji', () => {
  it('picks by size', () => {
    expect([0, 1, 2, 3, 6].map(familyEmoji)).toEqual(['🏠', '🏠', '👫', '👨‍👩‍👧', '👨‍👩‍👧']);
  });
});
