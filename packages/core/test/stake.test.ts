/**
 * What one bill did to one person's balance.
 *
 * This moved out of the phone's data layer when the web grew a ledger that had
 * to answer the same question, and it arrived here with no tests — so these are
 * the ones that would have caught the two ways it can be got wrong.
 *
 * The distinction that matters is `null` against `0n`. A blank row ("this bill
 * is between other people") and a settled row ("you paid and owed the same
 * amount") are different sentences, and both clients word them differently; a
 * helper that folded them together would make every expense somebody is not
 * part of read as one they are square on.
 */

import { describe, expect, it } from 'vitest';

import { myStake } from '../src/index';

const sides = (payers: [string, string][], shares: [string, string][]) => ({
  payers: payers.map(([member_id, amount]) => ({ member_id, amount })),
  shares: shares.map(([member_id, amount]) => ({ member_id, amount })),
});

describe('myStake', () => {
  it('is what you put in beyond your share', () => {
    // Paid 1000, owed 250 of it: lent 750.
    const version = sides(
      [['me', '1000']],
      [
        ['me', '250'],
        ['you', '750'],
      ],
    );
    expect(myStake(version, 'me')).toBe(750n);
  });

  it('is negative for your share of what somebody else paid', () => {
    const version = sides(
      [['you', '1000']],
      [
        ['me', '250'],
        ['you', '750'],
      ],
    );
    expect(myStake(version, 'me')).toBe(-250n);
  });

  it('is zero when you paid exactly what you owed', () => {
    const version = sides([['me', '250']], [['me', '250']]);
    expect(myStake(version, 'me')).toBe(0n);
  });

  it('is null — not zero — for a bill between other people', () => {
    const version = sides([['you', '1000']], [['you', '1000']]);
    expect(myStake(version, 'me')).toBeNull();
  });

  it('is null for a member written into the split with a zero share', () => {
    // Some imports list an excluded party rather than omitting them. That is
    // still "not involved", not "settled".
    const version = sides(
      [['you', '1000']],
      [
        ['me', '0'],
        ['you', '1000'],
      ],
    );
    expect(myStake(version, 'me')).toBeNull();
  });

  it('is null without a version or without a member', () => {
    expect(myStake(null, 'me')).toBeNull();
    expect(myStake(undefined, 'me')).toBeNull();
    expect(myStake(sides([['me', '10']], [['me', '10']]), null)).toBeNull();
  });

  it('reads amounts as minor units, not numbers', () => {
    // Beyond Number.MAX_SAFE_INTEGER: the ledger is bigint end to end, and a
    // helper that parsed with Number would quietly round a large total.
    const version = sides([['me', '9007199254740993']], [['me', '1']]);
    expect(myStake(version, 'me')).toBe(9007199254740992n);
  });
});
