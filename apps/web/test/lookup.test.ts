/**
 * Which channel a typed query means.
 *
 * Tested because of what a wrong answer costs. `waves_find_person` allows only
 * a few lookups per caller per day, so every query this function waves through
 * that cannot possibly match spends part of somebody's daily allowance to be
 * told nothing. The floors are not input validation for its own sake — the
 * server validates too — they are there so the ceiling is spent on real
 * questions.
 */

import { describe, expect, it } from 'vitest';

import { channelFor } from '@/lib/lookup';

describe('channelFor', () => {
  it('reads an ordinary address as email', () => {
    expect(channelFor('priya@example.com')).toBe('email');
    expect(channelFor('  priya@example.com  ')).toBe('email');
    // A domain with no dot is still a domain: intranet addresses exist, and
    // this is not the place to decide a hostname is unreal.
    expect(channelFor('priya@localhost')).toBe('email');
  });

  it('refuses something with an @ that is not an address', () => {
    for (const odd of ['a@@', '@example.com', 'priya@', '@', 'a@b@c', 'priya @ example.com']) {
      expect(channelFor(odd), odd).toBe(null);
    }
  });

  it('reads six digits or more as a phone number, however it is punctuated', () => {
    expect(channelFor('9884012345')).toBe('phone');
    expect(channelFor('+91 98840 12345')).toBe('phone');
    expect(channelFor('(044) 2811-1234')).toBe('phone');
  });

  it('refuses a number too short to mean anything', () => {
    for (const odd of ['', '   ', '12345', '+91', 'Priya']) {
      expect(channelFor(odd), odd).toBe(null);
    }
  });

  it('treats a spaced-out address as an address, not a number', () => {
    // The `@` decides first. Anything holding one is an attempt at an address,
    // and reading "a@1234567" as a phone number would search the wrong column.
    expect(channelFor('a@1234567')).toBe('email');
  });
});
