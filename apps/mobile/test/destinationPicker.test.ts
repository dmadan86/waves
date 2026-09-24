/**
 * The picker can open on a group that is really a person.
 *
 * A one-to-one group is the person's row on the People tab (it is listed under
 * Groups too). If the current destination is one of those groups, the picker must
 * still read back the choice; otherwise the selected rider, traveller or
 * financer disappears and Confirm is disabled until the person is picked again.
 */

import { describe, expect, it } from 'vitest';

import {
  groupsNewestFirst,
  initialDestinationTab,
  initialPickedPeople,
  type DestinationPersonChoice,
} from '../src/lib/destinationPickerState';

const people: (DestinationPersonChoice & { personKey: string })[] = [
  { personKey: 'user-key', name: 'User', groupId: 'user' },
  { personKey: 'rider-key', name: 'Rider', groupId: 'rider' },
  { personKey: 'traveller-key', name: 'Traveller', groupId: 'traveller' },
  { personKey: 'financer-key', name: 'Financer', groupId: 'financer' },
];

describe('DestinationPicker initial people selection', () => {
  it('opens existing one-to-one destinations on the People tab with the person picked', () => {
    for (const person of people) {
      const selection = { kind: 'existing' as const, groupId: person.groupId };

      expect(initialDestinationTab(selection, people)).toBe('people');
      expect(initialPickedPeople(selection, people)).toEqual([person.name]);
    }
  });

  it('keeps ordinary existing groups on the Groups tab without inventing people', () => {
    const selection = { kind: 'existing' as const, groupId: 'goa-trip' };

    expect(initialDestinationTab(selection, people)).toBe('groups');
    expect(initialPickedPeople(selection, people)).toEqual([]);
  });

  it('preserves an explicit multi-person draft selection', () => {
    const selection = { kind: 'people' as const, names: ['Rider', 'Traveller'] };

    expect(initialDestinationTab(selection, people)).toBe('people');
    expect(initialPickedPeople(selection, people)).toEqual(['Rider', 'Traveller']);
  });
});

describe('DestinationPicker groups tab', () => {
  it('lists every group newest first, including an unnamed 1:1 the People tab also shows', () => {
    const groups = [
      { id: 'goa-trip', name: 'Goa', created_at: '2026-09-01T00:00:00Z' },
      { id: 'user', name: null, created_at: '2026-09-20T00:00:00Z' },
      { id: 'b', name: 'Flat', created_at: '2026-09-10T00:00:00Z' },
      { id: 'a', name: 'Flat 2', created_at: '2026-09-10T00:00:00Z' },
    ];
    expect(groupsNewestFirst(groups).map((group) => group.id)).toEqual([
      'user',
      'a',
      'b',
      'goa-trip',
    ]);
    // `user` is also a People-tab row above; it is not dropped from Groups.
    expect(people.some((person) => person.groupId === 'user')).toBe(true);
  });
});
