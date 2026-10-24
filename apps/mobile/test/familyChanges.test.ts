/**
 * Unit tests for the families-change headline logic.
 *
 * Covers three paths:
 *  1. Map diff (new rows) — `from`/`to` are GroupUnits objects.
 *  2. Legacy count-based (old rows) — `from`/`to` are integers.
 *  3. `fromCount`/`toCount` fallback — new trigger shape read by an old build.
 */

import { describe, expect, it } from 'vitest';

import {
  diffFamilyMaps,
  familiesHeadline,
  familyChangeHeadline,
  familyChangeKey,
  familyMapHeadline,
  renderFamilyChange,
  type FamiliesStrings,
  type FamilyChange,
} from '@/lib/familyChanges';

const STRINGS: FamiliesStrings = {
  setupFamilies: 'Set up the families',
  addedFamily: 'Added a family',
  removedFamily: 'Removed a family',
  clearedFamilies: 'Removed all families',
  changedFamilies: 'Changed the families',
};

// ─────────────────────────────────────────────── legacy count path ──

describe('familyChangeKey', () => {
  it.each([
    // first families set up from zero
    [0, 1, 'setupFamilies'],
    [0, 3, 'setupFamilies'],
    // one family added to an existing set
    [1, 2, 'addedFamily'],
    [3, 4, 'addedFamily'],
    // one family removed; at least one remains
    [2, 1, 'removedFamily'],
    [4, 3, 'removedFamily'],
    // all families cleared
    [1, 0, 'clearedFamilies'],
    [5, 0, 'clearedFamilies'],
    // multiple families added or removed at once
    [1, 3, 'changedFamilies'],
    [4, 2, 'changedFamilies'],
  ] as const)('from %d to %d → %s', (from, to, expected) => {
    expect(familyChangeKey(from, to)).toBe(expected);
  });

  it('returns null when counts are equal (no change)', () => {
    expect(familyChangeKey(2, 2)).toBeNull();
  });

  it('returns null for non-number inputs', () => {
    expect(familyChangeKey(undefined, 1)).toBeNull();
    expect(familyChangeKey(1, undefined)).toBeNull();
    expect(familyChangeKey(null, 1)).toBeNull();
    expect(familyChangeKey('2', 3)).toBeNull();
    expect(familyChangeKey(NaN, 1)).toBeNull();
    expect(familyChangeKey(Infinity, 1)).toBeNull();
  });

  it('returns null for missing inputs (older rows)', () => {
    expect(familyChangeKey(undefined, undefined)).toBeNull();
  });
});

describe('familyChangeHeadline', () => {
  it('returns the localised string for a known change', () => {
    expect(familyChangeHeadline(0, 2, STRINGS)).toBe('Set up the families');
    expect(familyChangeHeadline(2, 3, STRINGS)).toBe('Added a family');
    expect(familyChangeHeadline(3, 2, STRINGS)).toBe('Removed a family');
    expect(familyChangeHeadline(3, 0, STRINGS)).toBe('Removed all families');
    expect(familyChangeHeadline(1, 4, STRINGS)).toBe('Changed the families');
  });

  it('returns null when the payload lacks usable counts', () => {
    expect(familyChangeHeadline(undefined, undefined, STRINGS)).toBeNull();
    expect(familyChangeHeadline(null, null, STRINGS)).toBeNull();
    expect(familyChangeHeadline('old', 'new', STRINGS)).toBeNull();
  });
});

// ─────────────────────────────────────────────────── map diff ──

const NAMES = new Map([
  ['m-anoop', 'Anoop'],
  ['m-ravi', 'Ravi'],
  ['m-anu', 'Anu'],
]);

// Helper: build a simple unit entry
function unit(
  name: string,
  members: string[],
  opts: { head?: string; weights?: Record<string, number> } = {},
) {
  return {
    name,
    members,
    ...(opts.head ? { head: opts.head } : {}),
    ...(opts.weights ? { weights: opts.weights } : {}),
  };
}

describe('diffFamilyMaps — created / removed families', () => {
  it('detects a new family created from null', () => {
    const changes = diffFamilyMaps(null, { u1: unit('Sharma family', ['m-anoop']) }, NAMES);
    expect(changes).toContainEqual<FamilyChange>({ kind: 'created', familyName: 'Sharma family' });
  });

  it('detects a family removed leaving null', () => {
    const changes = diffFamilyMaps({ u1: unit('Sharma family', ['m-anoop']) }, null, NAMES);
    expect(changes).toContainEqual<FamilyChange>({ kind: 'removed', familyName: 'Sharma family' });
  });

  it('detects a family created alongside an existing one', () => {
    const from = { u1: unit('Family1', ['m-ravi']) };
    const to = { u1: unit('Family1', ['m-ravi']), u2: unit('Family2', ['m-anoop']) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({ kind: 'created', familyName: 'Family2' });
    expect(changes.find((c) => c.kind === 'removed')).toBeUndefined();
  });

  it('detects a family removed when another remains', () => {
    const from = { u1: unit('Family1', ['m-ravi']), u2: unit('Family2', ['m-anoop']) };
    const to = { u1: unit('Family1', ['m-ravi']) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({ kind: 'removed', familyName: 'Family2' });
    expect(changes.find((c) => c.kind === 'created')).toBeUndefined();
  });
});

describe('diffFamilyMaps — renames', () => {
  it('detects a family rename (same id, different name)', () => {
    const from = { u1: unit('Family1', ['m-anoop']) };
    const to = { u1: unit('Sharma family', ['m-anoop']) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({
      kind: 'renamed',
      from: 'Family1',
      to: 'Sharma family',
    });
  });
});

describe('diffFamilyMaps — member moves', () => {
  it('detects a member moving between families', () => {
    const from = {
      u1: unit('Family1', ['m-anoop', 'm-ravi']),
      u2: unit('Family2', ['m-anu']),
    };
    const to = {
      u1: unit('Family1', ['m-ravi']),
      u2: unit('Family2', ['m-anu', 'm-anoop']),
    };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({
      kind: 'memberMoved',
      member: 'Anoop',
      from: 'Family1',
      to: 'Family2',
    });
  });

  it('does not also emit memberAdded/memberRemoved for a moved member', () => {
    const from = {
      u1: unit('Family1', ['m-anoop']),
      u2: unit('Family2', ['m-ravi']),
    };
    const to = {
      u1: unit('Family1', []),
      u2: unit('Family2', ['m-ravi', 'm-anoop']),
    };
    const changes = diffFamilyMaps(from, to, NAMES);
    const movedChange = changes.find((c) => c.kind === 'memberMoved' && c.member === 'Anoop');
    expect(movedChange).toBeDefined();
    expect(changes.find((c) => c.kind === 'memberAdded' && c.member === 'Anoop')).toBeUndefined();
    expect(changes.find((c) => c.kind === 'memberRemoved' && c.member === 'Anoop')).toBeUndefined();
  });
});

describe('diffFamilyMaps — member added / removed', () => {
  it('detects a member added to an existing family', () => {
    const from = { u1: unit('Family1', ['m-ravi']) };
    const to = { u1: unit('Family1', ['m-ravi', 'm-anoop']) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({
      kind: 'memberAdded',
      member: 'Anoop',
      familyName: 'Family1',
    });
  });

  it('detects a member removed from an existing family', () => {
    const from = { u1: unit('Family1', ['m-ravi', 'm-anoop']) };
    const to = { u1: unit('Family1', ['m-ravi']) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({
      kind: 'memberRemoved',
      member: 'Anoop',
      familyName: 'Family1',
    });
  });

  it('does not emit memberAdded when the whole family is new', () => {
    const from = {};
    const to = { u1: unit('Sharma family', ['m-anoop']) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes.find((c) => c.kind === 'memberAdded')).toBeUndefined();
    expect(changes).toContainEqual<FamilyChange>({ kind: 'created', familyName: 'Sharma family' });
  });

  it('does not emit memberRemoved when the whole family is gone', () => {
    const from = { u1: unit('Sharma family', ['m-anoop']) };
    const to = {};
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes.find((c) => c.kind === 'memberRemoved')).toBeUndefined();
    expect(changes).toContainEqual<FamilyChange>({ kind: 'removed', familyName: 'Sharma family' });
  });
});

describe('diffFamilyMaps — head changes', () => {
  it('detects when a head is set for the first time', () => {
    const from = { u1: unit('Family1', ['m-ravi', 'm-anoop']) };
    const to = { u1: unit('Family1', ['m-ravi', 'm-anoop'], { head: 'm-ravi' }) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({
      kind: 'headChanged',
      member: 'Ravi',
      familyName: 'Family1',
    });
  });

  it('detects when the head changes to a different member', () => {
    const from = { u1: unit('Family1', ['m-ravi', 'm-anoop'], { head: 'm-ravi' }) };
    const to = { u1: unit('Family1', ['m-ravi', 'm-anoop'], { head: 'm-anoop' }) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({
      kind: 'headChanged',
      member: 'Anoop',
      familyName: 'Family1',
    });
  });
});

describe('diffFamilyMaps — child / adult marking (weights)', () => {
  it('detects a member marked as a child (weight < 1)', () => {
    const from = { u1: unit('Family1', ['m-ravi', 'm-anu']) };
    const to = { u1: unit('Family1', ['m-ravi', 'm-anu'], { weights: { 'm-anu': 0.5 } }) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({
      kind: 'markedChild',
      member: 'Anu',
      familyName: 'Family1',
    });
  });

  it('detects a member marked back as an adult (weight ≥ 1)', () => {
    const from = { u1: unit('Family1', ['m-ravi', 'm-anu'], { weights: { 'm-anu': 0.5 } }) };
    const to = { u1: unit('Family1', ['m-ravi', 'm-anu'], { weights: { 'm-anu': 1 } }) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({
      kind: 'markedAdult',
      member: 'Anu',
      familyName: 'Family1',
    });
  });
});

describe('diffFamilyMaps — member name lookup', () => {
  it('falls back to the member id when no name map is provided', () => {
    const from = {};
    const to = { u1: unit('Family1', ['m-unknown']) };
    const changes = diffFamilyMaps(from, to);
    // No name map supplied — created, no memberAdded
    expect(changes).toContainEqual<FamilyChange>({ kind: 'created', familyName: 'Family1' });
  });

  it('uses the display name from the names map', () => {
    const from = { u1: unit('Family1', ['m-ravi']) };
    const to = { u1: unit('Family1', ['m-ravi', 'm-anoop']) };
    const changes = diffFamilyMaps(from, to, NAMES);
    expect(changes).toContainEqual<FamilyChange>({
      kind: 'memberAdded',
      member: 'Anoop',
      familyName: 'Family1',
    });
  });

  it('falls back to someone for unknown member ids', () => {
    const from = { u1: unit('Family1', ['m-ravi']) };
    const to = { u1: unit('Family1', ['m-ravi', 'm-xyz']) };
    const changes = diffFamilyMaps(from, to, NAMES);
    const added = changes.find(
      (c): c is Extract<FamilyChange, { kind: 'memberAdded' }> => c.kind === 'memberAdded',
    );
    expect(added?.member).toBe('someone');
  });
});

// ──────────────────────────────────────── renderFamilyChange ──

describe('renderFamilyChange', () => {
  it.each([
    [{ kind: 'created', familyName: 'Sharma family' } as FamilyChange, 'Created Sharma family'],
    [{ kind: 'removed', familyName: 'Sharma family' } as FamilyChange, 'Removed Sharma family'],
    [
      { kind: 'renamed', from: 'Family1', to: 'Sharma family' } as FamilyChange,
      'Renamed Family1 to Sharma family',
    ],
    [
      { kind: 'memberMoved', member: 'Anoop', from: 'Family1', to: 'Family2' } as FamilyChange,
      'Moved Anoop to Family2',
    ],
    [
      { kind: 'memberAdded', member: 'Anoop', familyName: 'Family1' } as FamilyChange,
      'Added Anoop to Family1',
    ],
    [
      { kind: 'memberRemoved', member: 'Anoop', familyName: 'Family1' } as FamilyChange,
      'Took Anoop out of Family1',
    ],
    [
      { kind: 'headChanged', member: 'Ravi', familyName: 'Family1' } as FamilyChange,
      'Made Ravi head of Family1',
    ],
    [
      { kind: 'markedChild', member: 'Anu', familyName: 'Family1' } as FamilyChange,
      'Marked Anu as a child in Family1',
    ],
    [
      { kind: 'markedAdult', member: 'Anu', familyName: 'Family1' } as FamilyChange,
      'Marked Anu as an adult in Family1',
    ],
  ])('%j → %s', (change, expected) => {
    expect(renderFamilyChange(change)).toBe(expected);
  });
});

// ─────────────────────────────────────── familyMapHeadline ──

describe('familyMapHeadline', () => {
  it('returns the single change title when there is exactly one change', () => {
    const from = null;
    const to = { u1: unit('Sharma family', ['m-anoop']) };
    expect(familyMapHeadline(from, to, NAMES)).toBe('Created Sharma family');
  });

  it('appends "and N more" when there are multiple changes', () => {
    const from = { u1: unit('Family1', ['m-ravi']), u2: unit('Family2', ['m-anoop']) };
    const to = {
      u1: unit('Family1 renamed', ['m-ravi']),
      u2: unit('Family2', ['m-anoop', 'm-anu']),
    };
    const headline = familyMapHeadline(from, to, NAMES);
    expect(headline).toMatch(/and \d+ more$/);
  });

  it('returns null when no changes are detected', () => {
    const from = { u1: unit('Family1', ['m-ravi']) };
    const to = { u1: unit('Family1', ['m-ravi']) };
    expect(familyMapHeadline(from, to, NAMES)).toBeNull();
  });

  it('returns null for two null maps', () => {
    expect(familyMapHeadline(null, null)).toBeNull();
  });
});

// ───────────────────────────────────────── familiesHeadline ──

describe('familiesHeadline — unified entry point', () => {
  it('path 1: uses map diff when from is an object', () => {
    const payload = {
      from: null,
      to: { u1: unit('Sharma family', ['m-anoop']) },
      fromCount: 0,
      toCount: 1,
    };
    expect(familiesHeadline(payload, STRINGS, NAMES)).toBe('Created Sharma family');
  });

  it('path 1: falls back to count strings when map diff finds no changes but counts differ', () => {
    // Two identical maps but counts say something changed (edge case guard)
    const sameUnits = { u1: unit('Family1', ['m-ravi']) };
    const payload = { from: sameUnits, to: sameUnits, fromCount: 1, toCount: 2 };
    // map diff returns null → falls back to fromCount/toCount
    expect(familiesHeadline(payload, STRINGS, NAMES)).toBe('Added a family');
  });

  it('path 2: old-style integers in from/to', () => {
    expect(familiesHeadline({ from: 0, to: 3 }, STRINGS)).toBe('Set up the families');
    expect(familiesHeadline({ from: 2, to: 3 }, STRINGS)).toBe('Added a family');
    expect(familiesHeadline({ from: 3, to: 2 }, STRINGS)).toBe('Removed a family');
    expect(familiesHeadline({ from: 3, to: 0 }, STRINGS)).toBe('Removed all families');
    expect(familiesHeadline({ from: 1, to: 4 }, STRINGS)).toBe('Changed the families');
  });

  it('path 3: fromCount/toCount when from/to are absent (new trigger, old build)', () => {
    expect(familiesHeadline({ fromCount: 0, toCount: 2 }, STRINGS)).toBe('Set up the families');
    expect(familiesHeadline({ fromCount: 2, toCount: 3 }, STRINGS)).toBe('Added a family');
    expect(familiesHeadline({ fromCount: 5, toCount: 0 }, STRINGS)).toBe('Removed all families');
  });

  it('path 4: returns null when there is nothing usable in the payload', () => {
    expect(familiesHeadline({}, STRINGS)).toBeNull();
    expect(familiesHeadline({ from: undefined, to: undefined }, STRINGS)).toBeNull();
  });
});

// ──────────────────────────────────── i18n strings via fill() ──

describe('familiesHeadline — count path in every language via fill()', () => {
  // Represent the four languages with simple string tables that match the
  // structure the i18n index exports, to verify the count-based headlines work
  // regardless of locale.

  const EN: FamiliesStrings = {
    setupFamilies: 'Set up the families',
    addedFamily: 'Added a family',
    removedFamily: 'Removed a family',
    clearedFamilies: 'Removed all families',
    changedFamilies: 'Changed the families',
  };

  // Tamil (representative non-Latin locale)
  const TA: FamiliesStrings = {
    setupFamilies: 'குடும்பங்கள் அமைக்கப்பட்டன',
    addedFamily: 'ஒரு குடும்பம் சேர்க்கப்பட்டது',
    removedFamily: 'ஒரு குடும்பம் நீக்கப்பட்டது',
    clearedFamilies: 'அனைத்து குடும்பங்களும் நீக்கப்பட்டன',
    changedFamilies: 'குடும்பங்கள் மாற்றப்பட்டன',
  };

  // Hindi
  const HI: FamiliesStrings = {
    setupFamilies: 'परिवार बनाए',
    addedFamily: 'एक परिवार जोड़ा',
    removedFamily: 'एक परिवार हटाया',
    clearedFamilies: 'सभी परिवार हटाए',
    changedFamilies: 'परिवार बदले',
  };

  // Arabic (RTL)
  const AR: FamiliesStrings = {
    setupFamilies: 'أنشأ العائلات',
    addedFamily: 'أضاف عائلة',
    removedFamily: 'حذف عائلة',
    clearedFamilies: 'حذف جميع العائلات',
    changedFamilies: 'غيّر العائلات',
  };

  it.each([
    ['en', EN, 0, 2, 'Set up the families'],
    ['en', EN, 2, 3, 'Added a family'],
    ['en', EN, 3, 0, 'Removed all families'],
    ['ta', TA, 0, 2, 'குடும்பங்கள் அமைக்கப்பட்டன'],
    ['ta', TA, 2, 3, 'ஒரு குடும்பம் சேர்க்கப்பட்டது'],
    ['ta', TA, 3, 0, 'அனைத்து குடும்பங்களும் நீக்கப்பட்டன'],
    ['hi', HI, 0, 2, 'परिवार बनाए'],
    ['hi', HI, 2, 3, 'एक परिवार जोड़ा'],
    ['hi', HI, 3, 0, 'सभी परिवार हटाए'],
    ['ar', AR, 0, 2, 'أنشأ العائلات'],
    ['ar', AR, 2, 3, 'أضاف عائلة'],
    ['ar', AR, 3, 0, 'حذف جميع العائلات'],
  ] as const)('%s from %d to %d → %s', (_locale, strings, from, to, expected) => {
    expect(familiesHeadline({ from, to }, strings)).toBe(expected);
  });
});
