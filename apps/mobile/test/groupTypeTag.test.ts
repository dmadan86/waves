import { describe, expect, it } from 'vitest';

import { GroupType } from '../src/data/types';
import { groupTypeTag, type GroupTypeTagLabels } from '../src/lib/groupTypeTag';

const labels: GroupTypeTagLabels = {
  types: { trip: 'Trip', home: 'Home', couple: 'Couple', event: 'Event', friends: 'Friends' },
  events: { wedding_in: 'Wedding', wedding_west: 'Wedding', birthday: 'Birthday', other: 'Event' },
};

describe('groupTypeTag', () => {
  it('labels the plain types', () => {
    expect(groupTypeTag('trip', null, labels)).toEqual({ type: GroupType.Trip, label: 'Trip' });
    expect(groupTypeTag('home', undefined, labels)?.label).toBe('Home');
    expect(groupTypeTag('couple', null, labels)?.label).toBe('Couple');
    expect(groupTypeTag('friends', null, labels)?.label).toBe('Friends');
  });

  it('shows the event kind for event groups', () => {
    expect(groupTypeTag('event', 'wedding_in', labels)?.label).toBe('Wedding');
    expect(groupTypeTag('event', 'wedding_west', labels)?.label).toBe('Wedding');
    expect(groupTypeTag('event', 'birthday', labels)?.label).toBe('Birthday');
    expect(groupTypeTag('event', 'birthday', labels)?.type).toBe(GroupType.Event);
  });

  it('falls back to "Event" for no, other or unknown templates', () => {
    expect(groupTypeTag('event', null, labels)?.label).toBe('Event');
    expect(groupTypeTag('event', 'other', labels)?.label).toBe('Event');
    expect(groupTypeTag('event', 'bogus', labels)?.label).toBe('Event');
  });

  it('ignores the template on non-event groups', () => {
    expect(groupTypeTag('trip', 'birthday', labels)?.label).toBe('Trip');
  });

  it('gives no tag for other, empty or unknown types', () => {
    expect(groupTypeTag('other', null, labels)).toBeNull();
    expect(groupTypeTag(null, null, labels)).toBeNull();
    expect(groupTypeTag(undefined, null, labels)).toBeNull();
    expect(groupTypeTag('mystery', null, labels)).toBeNull();
  });
});
