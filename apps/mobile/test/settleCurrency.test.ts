/**
 * What the screens say about a group that settles in its own currency
 * (ADR-003 amendment). The money itself is core's and is property-tested there.
 */

import { describe, expect, it } from 'vitest';

import { convertedCaption, convertSwitchBlocks, isRatelessTransfer } from '@/lib/settleCurrency';

describe('rate-less debts in a converting group', () => {
  it('marks a foreign transfer as rate-less only when the group converts', () => {
    expect(isRatelessTransfer({ currency: 'VND' }, 'INR', true)).toBe(true);
    expect(isRatelessTransfer({ currency: 'INR' }, 'INR', true)).toBe(false);
    // A group that has not opted in pays every currency as before.
    expect(isRatelessTransfer({ currency: 'VND' }, 'INR', false)).toBe(false);
  });
});

describe('the converted caption', () => {
  // The English string; every locale carries one (UiStrings makes it required).
  const template = 'Includes {currencies} bills at their recorded rates';

  it('names the converted currencies by symbol', () => {
    expect(convertedCaption(['VND'], 'en-IN', template)).toBe(
      'Includes ₫ bills at their recorded rates',
    );
  });

  it('says nothing when nothing was converted', () => {
    expect(convertedCaption([], 'en-IN', template)).toBeNull();
  });
});

describe('the settle-in-currency switch', () => {
  const ready: never[] = [];

  it('is free for an admin of a ready group', () => {
    expect(
      convertSwitchBlocks({ on: false, isAdmin: true, readiness: ready, settlementCount: 0 }),
    ).toEqual([]);
  });

  it('lists every reason a group is not ready', () => {
    expect(
      convertSwitchBlocks({
        on: false,
        isAdmin: true,
        readiness: [
          { currency: 'EUR', missing_rates: 0, foreign_settlements: 1 },
          { currency: 'VND', missing_rates: 3, foreign_settlements: 0 },
        ],
        settlementCount: 1,
      }),
    ).toEqual([
      { kind: 'foreignSettlements', currency: 'EUR' },
      { kind: 'missingRates', currency: 'VND', count: 3 },
    ]);
  });

  it('is admin-only', () => {
    expect(
      convertSwitchBlocks({ on: false, isAdmin: false, readiness: ready, settlementCount: 0 }),
    ).toEqual([{ kind: 'adminOnly' }]);
    expect(
      convertSwitchBlocks({ on: true, isAdmin: false, readiness: ready, settlementCount: 0 }),
    ).toEqual([{ kind: 'adminOnly' }]);
  });

  it('stays on once a settlement exists', () => {
    expect(
      convertSwitchBlocks({ on: true, isAdmin: true, readiness: ready, settlementCount: 2 }),
    ).toEqual([{ kind: 'locked' }]);
    expect(
      convertSwitchBlocks({ on: true, isAdmin: true, readiness: ready, settlementCount: 0 }),
    ).toEqual([]);
  });
});
