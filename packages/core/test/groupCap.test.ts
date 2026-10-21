/**
 * The Free ceiling on starting groups: ten, counted the way the database
 * counts them (creator's, not deleted, not a pair), and never for Pro.
 */

import { describe, expect, it } from 'vitest';

import {
  countsTowardGroupCap,
  FREE_GROUP_LIMIT,
  FREE_GROUP_LIMIT_CODE,
  groupCapGate,
  groupCreateLimit,
  isFreeGroupLimitError,
} from '../src/billing/groupCap';
import { PlanTier } from '../src/billing/plans';

describe('groupCreateLimit', () => {
  it('is ten for Free and unbounded for Pro', () => {
    expect(FREE_GROUP_LIMIT).toBe(10);
    expect(groupCreateLimit(PlanTier.Free)).toBe(10);
    expect(groupCreateLimit(PlanTier.Pro)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('groupCapGate', () => {
  it('lets a Free account start its tenth group and refuses the eleventh', () => {
    expect(groupCapGate({ tier: PlanTier.Free, createdCount: 9 })).toEqual({
      limit: 10,
      created: 9,
      remaining: 1,
      atLimit: false,
      canCreate: true,
    });
    const atLimit = groupCapGate({ tier: PlanTier.Free, createdCount: 10 });
    expect(atLimit.atLimit).toBe(true);
    expect(atLimit.canCreate).toBe(false);
    expect(atLimit.remaining).toBe(0);
  });

  it('never closes for Pro', () => {
    const gate = groupCapGate({ tier: PlanTier.Pro, createdCount: 500 });
    expect(gate.canCreate).toBe(true);
    expect(gate.atLimit).toBe(false);
    expect(gate.remaining).toBe(Number.POSITIVE_INFINITY);
  });

  it('fails open on a count that is not a number', () => {
    expect(groupCapGate({ tier: PlanTier.Free, createdCount: Number.NaN }).canCreate).toBe(true);
    expect(groupCapGate({ tier: PlanTier.Free, createdCount: -3 }).created).toBe(0);
  });
});

describe('countsTowardGroupCap', () => {
  const me = 'me';

  it('counts a group I created with any number of members but two', () => {
    expect(countsTowardGroupCap({ created_by: me, deleted_at: null }, me, 1)).toBe(true);
    expect(countsTowardGroupCap({ created_by: me, deleted_at: null }, me, 3)).toBe(true);
    expect(countsTowardGroupCap({ created_by: me, deleted_at: null }, me, 6)).toBe(true);
  });

  it('leaves a pair out — the one-to-one ledger is two live members', () => {
    expect(countsTowardGroupCap({ created_by: me, deleted_at: null }, me, 2)).toBe(false);
  });

  it('leaves out groups somebody else started, however many I am in', () => {
    expect(countsTowardGroupCap({ created_by: 'them', deleted_at: null }, me, 4)).toBe(false);
  });

  it('leaves out a deleted group and keeps an archived one', () => {
    expect(
      countsTowardGroupCap({ created_by: me, deleted_at: '2026-01-01T00:00:00Z' }, me, 3),
    ).toBe(false);
    // Archiving is not modelled here at all: the row has no say, so it counts.
    expect(countsTowardGroupCap({ created_by: me, deleted_at: null }, me, 3)).toBe(true);
  });

  it('counts a group that exists only in the local queue as mine', () => {
    expect(countsTowardGroupCap({ pending: true, deleted_at: null }, me, 1)).toBe(true);
    expect(countsTowardGroupCap({ pending: true, deleted_at: null }, null, 1)).toBe(true);
  });

  it('does not count a server row with no creator', () => {
    expect(countsTowardGroupCap({ created_by: null, deleted_at: null }, me, 3)).toBe(false);
    expect(countsTowardGroupCap({ created_by: me, deleted_at: null }, null, 3)).toBe(false);
  });
});

describe('isFreeGroupLimitError', () => {
  it('recognises the refusal in every shape it arrives', () => {
    expect(isFreeGroupLimitError({ message: `${FREE_GROUP_LIMIT_CODE}: up to 10 groups` })).toBe(
      true,
    );
    expect(isFreeGroupLimitError(new Error('FREE_GROUP_LIMIT: Free plan lets you create'))).toBe(
      true,
    );
    expect(isFreeGroupLimitError({ code: FREE_GROUP_LIMIT_CODE, message: 'refused' })).toBe(true);
    expect(isFreeGroupLimitError('FREE_GROUP_LIMIT: x')).toBe(true);
  });

  it('is not fooled by other refusals', () => {
    expect(isFreeGroupLimitError({ message: 'GUEST_GROUP_LIMIT: sign up' })).toBe(false);
    expect(isFreeGroupLimitError(new Error('NOT_A_MEMBER'))).toBe(false);
    expect(isFreeGroupLimitError(null)).toBe(false);
    expect(isFreeGroupLimitError(undefined)).toBe(false);
    expect(isFreeGroupLimitError(42)).toBe(false);
  });
});
