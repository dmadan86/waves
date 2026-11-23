import { describe, expect, it } from 'vitest';

import { computeShares } from '../src/split/computeShares';
import {
  canSwitchLedgerMode,
  isPoolGroup,
  ledgerModeOf,
  poolExpensePayload,
  poolSplit,
  switchKeepsOpenBalances,
} from '../src/group/ledgerMode';

describe('poolSplit', () => {
  it('makes every share equal what the payer paid, so nobody owes', () => {
    const payers = { a: 700n, b: 300n };
    const { splitParams, participants } = poolSplit(payers);
    expect(participants.sort()).toEqual(['a', 'b']);
    const shares = computeShares({
      amount: 1000n,
      currency: 'INR',
      params: splitParams,
      participants,
      seed: 'seed',
    });
    expect(Object.fromEntries(shares)).toEqual(payers);
  });

  it('drops zero payers', () => {
    expect(poolSplit({ a: 500n, b: 0n }).participants).toEqual(['a']);
  });
});

describe('poolExpensePayload', () => {
  const base = {
    amount: '1000',
    payers: { a: '1000' },
    splitParams: { kind: 'equal' },
    participants: ['a', 'b'],
  };
  it('pools an equal split', () => {
    const out = poolExpensePayload({ ...base, expectedShares: { a: '500' } });
    expect(out.splitParams).toEqual({ kind: 'exact', amounts: { a: '1000' } });
    expect(out.participants).toEqual(['a']);
    expect(out.expectedShares).toBeUndefined();
  });
  it('honours Split this one and strips the flag', () => {
    const out = poolExpensePayload({ ...base, splitThisOne: true });
    expect(out.splitParams).toEqual({ kind: 'equal' });
    expect(out.splitThisOne).toBeUndefined();
  });
  it('leaves explicit splits alone', () => {
    const p = { ...base, splitParams: { kind: 'percent', basisPoints: {} } };
    expect(poolExpensePayload(p)).toBe(p);
  });
});

describe('mode helpers', () => {
  it('reads a missing mode as split', () => {
    expect(ledgerModeOf({})).toBe('split');
    expect(isPoolGroup({ ledger_mode: 'pool' })).toBe(true);
  });
  it('only admins switch, and only to a different mode', () => {
    expect(canSwitchLedgerMode(true, 'split', 'pool')).toBe(true);
    expect(canSwitchLedgerMode(false, 'split', 'pool')).toBe(false);
    expect(canSwitchLedgerMode(true, 'pool', 'pool')).toBe(false);
    expect(switchKeepsOpenBalances(2)).toBe(true);
  });
});
