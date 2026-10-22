/**
 * The voice "Save to" sheet: one destination at a time, confirmed by "Save here".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canSaveHere,
  groupSubtitle,
  pickPlace,
  seededPerson,
  unchangedSeedGroupId,
  togglePersonPick,
} from '../src/lib/saveToSheetState';

const source = readFileSync(join(process.cwd(), 'src/components/SaveToSheet.tsx'), 'utf8');

describe('single-selection rule', () => {
  it('a place replaces a people pick, and people replace a place', () => {
    const people = togglePersonPick({ kind: 'me' }, 'Ravi');
    expect(people).toEqual({ kind: 'people', names: ['Ravi'] });
    expect(pickPlace({ kind: 'unassigned' })).toEqual({ kind: 'unassigned' });
    expect(pickPlace({ kind: 'existing', groupId: 'g' })).toEqual({
      kind: 'existing',
      groupId: 'g',
    });
  });

  it('people are a set; emptying it leaves nothing, so Save here is off', () => {
    const two = togglePersonPick(togglePersonPick({ kind: 'none' }, 'Ravi'), 'asha');
    expect(two).toEqual({ kind: 'people', names: ['Ravi', 'asha'] });
    const one = togglePersonPick(two, 'ASHA');
    expect(one).toEqual({ kind: 'people', names: ['Ravi'] });
    const none = togglePersonPick(one, 'ravi');
    expect(none).toEqual({ kind: 'none' });
    expect(canSaveHere(none)).toBe(false);
    expect(canSaveHere({ kind: 'unassigned' })).toBe(true);
  });
});

describe('seeded 1:1 contact', () => {
  const people = [
    { name: 'Alex', groupId: 'g1' },
    { name: 'Alex', groupId: 'g2' },
  ];
  it('keeps the original group id when unchanged, even with two Alexes', () => {
    const seed = seededPerson({ kind: 'existing', groupId: 'g2' }, people);
    expect(unchangedSeedGroupId({ kind: 'people', names: ['Alex'] }, seed)).toBe('g2');
  });
  it('resolves by name only once the pick changes', () => {
    const seed = seededPerson({ kind: 'existing', groupId: 'g2' }, people);
    expect(unchangedSeedGroupId({ kind: 'people', names: ['Alex', 'Sam'] }, seed)).toBeNull();
    expect(unchangedSeedGroupId({ kind: 'me' }, seed)).toBeNull();
    expect(seededPerson({ kind: 'existing', groupId: 'x' }, people)).toBeUndefined();
  });
});

describe('group subtitle', () => {
  const fmt = (iso: string) => iso.slice(5);
  it('adds the dates only when the group has both', () => {
    expect(groupSubtitle('5 members', '2026-10-11', '2026-10-18', fmt)).toBe(
      '5 members · 10-11 – 10-18',
    );
    expect(groupSubtitle('2 members', null, null, fmt)).toBe('2 members');
    expect(groupSubtitle('2 members', '2026-10-11', null, fmt)).toBe('2 members');
  });
});

describe('SaveToSheet structure (source-pinned)', () => {
  it('has the chips, the two tabs, per-tab search and a sticky Save here', () => {
    expect(source).toContain('t.voice.saveForLater');
    expect(source).toContain('<PersonAvatar name={viewer.name}');
    expect(source).toContain("value: 'groups'");
    expect(source).toContain("value: 'people'");
    expect(source).toContain('t.voice.searchGroups');
    expect(source).toContain('t.voice.searchPeopleShort');
    expect(source).toContain('t.voice.saveHere');
    // The button sits outside the scrolling list, so it stays put.
    expect(source.indexOf('</ScrollView>')).toBeLessThan(source.indexOf('t.voice.saveHere'));
  });

  it('keeps one pick state, so the chips and rows cannot both be selected', () => {
    expect(source.match(/useState<SaveToPick>/g)).toHaveLength(1);
    expect(source).toContain('personalOffered');
  });
});
