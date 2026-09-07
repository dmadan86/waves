/**
 * The rules that decide whether two written-down people are the same person.
 *
 * Worth testing on its own because the failures are invisible: a picker that
 * quietly fails to recognise `+91 98765 43210` as the number already in a group
 * looks like a working picker, and only turns into a duplicate member and a
 * wrong balance later on. Every case below is a real spelling somebody's phone
 * uses.
 */

import { describe, expect, it } from 'vitest';

import {
  buildKnownIndex,
  digitsOf,
  fold,
  lookupKnown,
  matchesContactQuery,
  sameAddress,
  samePhone,
} from '../src/lib/contactMatch';

describe('folding text', () => {
  it('drops case and accents', () => {
    expect(fold('José')).toBe('jose');
    expect(fold('RENÉE')).toBe('renee');
    expect(fold('Ravi')).toBe('ravi');
  });

  it('leaves scripts without combining marks alone', () => {
    expect(fold('ரவி')).toBe('ரவி');
    expect(fold('रवि')).toBe('रवि');
  });
});

describe('reading a written number', () => {
  it('keeps only digits', () => {
    expect(digitsOf('+91 98765-43210')).toBe('919876543210');
    expect(digitsOf('(650) 213 7379')).toBe('6502137379');
  });

  it('drops the trunk zero', () => {
    expect(digitsOf('09876543210')).toBe('9876543210');
  });

  it('folds Arabic, Devanagari, and Tamil digits to ASCII', () => {
    expect(digitsOf('+٩١ ٩٨٧٦٥ ٤٣٢١٠')).toBe('919876543210');
    expect(digitsOf('+९१ ९८७६५ ४३२१०')).toBe('919876543210');
    expect(digitsOf('+௯௧ ௯௮௭௬௫ ௪௩௨௧௦')).toBe('919876543210');
  });
});

describe('the same line, written three ways', () => {
  it('matches an Indian mobile with and without its country code', () => {
    expect(samePhone('+919876543210', '9876543210')).toBe(true);
    expect(samePhone('+91 98765 43210', '098765 43210')).toBe(true);
    expect(samePhone('+919876543210', '+91 98765-43210')).toBe(true);
  });

  it('matches a US number written locally', () => {
    expect(samePhone('+16502137379', '(650) 213-7379')).toBe(true);
  });

  it('matches local numeral phone cards to stored invite numbers', () => {
    expect(samePhone('+٩١ ٩٨٧٦٥ ٤٣٢١٠', '9876543210')).toBe(true);
    expect(samePhone('+९१ ९८७६५ ४३२१०', '9876543210')).toBe(true);
    expect(samePhone('+௯௧ ௯௮௭௬௫ ௪௩௨௧௦', '9876543210')).toBe(true);
  });

  it('keeps two different people apart', () => {
    expect(samePhone('+919876543210', '+919876543211')).toBe(false);
    expect(samePhone('+919876543210', '+441234567890')).toBe(false);
  });

  it('will not call a short code the tail of a real number', () => {
    // Six digits is short enough that ending a long number is coincidence.
    expect(samePhone('543210', '+919876543210')).toBe(false);
    expect(samePhone('543210', '543210')).toBe(true);
  });

  it('is false when either side has no number', () => {
    expect(samePhone(null, '+919876543210')).toBe(false);
    expect(samePhone('+919876543210', '')).toBe(false);
  });
});

describe('two addresses for one person', () => {
  it('matches on a folded email', () => {
    expect(
      sameAddress(
        { email: 'Ravi@Example.com', phone: null },
        { email: 'ravi@example.com', phone: null },
      ),
    ).toBe(true);
  });

  it('matches on the number when the emails differ', () => {
    expect(
      sameAddress(
        { email: 'ravi@work.com', phone: '+919876543210' },
        { email: 'ravi@home.com', phone: '9876543210' },
      ),
    ).toBe(true);
  });

  it('does not match two people with nothing in common', () => {
    expect(sameAddress({ email: 'a@x.com', phone: null }, { email: 'b@x.com', phone: null })).toBe(
      false,
    );
  });
});

describe('searching the address book', () => {
  const ravi = { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '+919876543210' };
  const jose = { name: 'José Álvarez', email: null, phone: '+34600123456' };

  it('finds a name however the accents were typed', () => {
    expect(matchesContactQuery(jose, 'jose')).toBe(true);
    expect(matchesContactQuery(jose, 'álva')).toBe(true);
    expect(matchesContactQuery(jose, 'ALVAREZ')).toBe(true);
  });

  it('finds an email', () => {
    expect(matchesContactQuery(ravi, 'EXAMPLE.com')).toBe(true);
  });

  it('finds a number typed with or without spacing and country code', () => {
    expect(matchesContactQuery(ravi, '9876543210')).toBe(true);
    expect(matchesContactQuery(ravi, '98765 43210')).toBe(true);
    expect(matchesContactQuery(ravi, '+91 98765')).toBe(true);
    expect(matchesContactQuery(ravi, '098765')).toBe(true);
  });

  it('finds a number typed or stored with local numerals', () => {
    expect(matchesContactQuery(ravi, '٩٨٧٦٥')).toBe(true);
    expect(
      matchesContactQuery({ name: 'மீரா', email: null, phone: '+௯௧ ௯௮௭௬௫ ௪௩௨௧௦' }, '98765'),
    ).toBe(true);
  });

  it('refuses a number that is not theirs', () => {
    expect(matchesContactQuery(ravi, '5551234')).toBe(false);
  });

  it('treats an empty query as everybody', () => {
    expect(matchesContactQuery(ravi, '   ')).toBe(true);
  });
});

describe('the index of people already written down', () => {
  const index = buildKnownIndex([
    {
      id: 'goa',
      label: 'Goa trip',
      members: [
        { name: 'Ravi Kumar', email: null, phone: '+919876543210' },
        { name: 'Priya', email: 'priya@example.com', phone: null },
      ],
    },
    {
      id: 'flat',
      label: 'Flatmates',
      members: [
        // The same Ravi, written down without his country code this time.
        { name: 'Ravi', email: null, phone: '9876543210' },
        { name: 'Meera', email: null, phone: null },
      ],
    },
  ]);

  it('folds one person across the groups they are in', () => {
    const ravi = lookupKnown(index, { name: 'Ravi K', email: null, phone: '098765 43210' });
    expect(ravi?.groupIds).toEqual(['goa', 'flat']);
    expect(ravi?.groupNames).toEqual(['Goa trip', 'Flatmates']);
  });

  it('recognises an already-known person whose phone uses local numerals', () => {
    const ravi = lookupKnown(index, { name: 'Ravi K', email: null, phone: '+٩١ ٩٨٧٦٥ ٤٣٢١٠' });
    expect(ravi?.groupIds).toEqual(['goa', 'flat']);
  });

  it('names the single group somebody is in', () => {
    const priya = lookupKnown(index, { name: 'Priya S', email: 'PRIYA@example.com', phone: null });
    expect(priya?.groupNames).toEqual(['Goa trip']);
  });

  it('falls back to the name only for a member with no address at all', () => {
    expect(lookupKnown(index, { name: 'Meera', email: null, phone: null })?.groupIds).toEqual([
      'flat',
    ]);
  });

  it('does not match a stranger who happens to share a first name', () => {
    // Ravi is known by number, so a different Ravi with a different number is a
    // different person — the name must not reach past the address.
    expect(lookupKnown(index, { name: 'Ravi', email: null, phone: '+919999999999' })).toBeNull();
  });

  it('returns null for somebody nobody has written down', () => {
    expect(lookupKnown(index, { name: 'Sam', email: 'sam@x.com', phone: null })).toBeNull();
  });

  it('skips members with no name at all', () => {
    expect(
      buildKnownIndex([
        { id: 'g', label: 'G', members: [{ name: '  ', email: 'x@y.com', phone: null }] },
      ]).people,
    ).toEqual([]);
  });
});
