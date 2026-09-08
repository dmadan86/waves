/**
 * The avatar's fallback letters.
 *
 * This is pinned because it shipped wrong and nothing caught it: names imported
 * from a phone's address book carry a leading dot (".Rvs Amirnath", ".Rvs Arun
 * T", ".Rvs Anoop"), the old rule took the first character literally, and three
 * different people were drawn as the same ".A" circle — two of them side by
 * side on one row of the who-pays-whom screen.
 */

import { describe, expect, it } from 'vitest';

import { initialsOf } from '@waves/ui/initials';

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Ravi Kumar')).toBe('RK');
    expect(initialsOf('Asha')).toBe('A');
    expect(initialsOf('Ravi Kumar Menon')).toBe('RK');
  });

  it('skips punctuation in front of a name', () => {
    expect(initialsOf('·Anoop')).toBe('A');
    expect(initialsOf('  Priya  Sharma ')).toBe('PS');
  });

  it('skips short punctuated contact prefixes instead of making every imported contact identical', () => {
    // The bug: all three of these used to come back as '.A', and then as the
    // equally unhelpful 'RA' when the leading dot alone was stripped.
    expect(initialsOf('.Rvs Amirnath')).toBe('A');
    expect(initialsOf('.Rvs Arun T')).toBe('AT');
    expect(initialsOf('.Rvs Anoop')).toBe('A');
  });

  it('keeps the first letter of a non-Latin name', () => {
    expect(initialsOf('அசோக் குமார்')).toBe('அக');
    expect(initialsOf('محمد علي')).toBe('مع');
  });

  it('falls back to a question mark when there is no letter to take', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('...')).toBe('?');
  });

  it('never splits a character in half', () => {
    // A single astral code point is two code units; `charAt(0)` returned a lone
    // surrogate, which renders as a replacement box.
    expect([...initialsOf('𝒜lice')]).toHaveLength(1);
  });
});
