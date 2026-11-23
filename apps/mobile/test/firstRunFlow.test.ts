import { describe, expect, it } from 'vitest';

import {
  decideFirstRun,
  isInviteRoute,
  nameForField,
  routeForIntents,
  summariseHeard,
  type IntentNames,
} from '@/lib/firstRunFlow';

const names: IntentNames = {
  trip: 'Our trip',
  flat: 'Our flat',
  family: 'Family',
  couple: 'Us two',
};
const ready = { groupsReady: true, groupCount: 0 };

describe('decideFirstRun', () => {
  it('shows to a new account', () => {
    expect(decideFirstRun({ seen: false, introSeen: false, ...ready })).toBe('show');
  });
  it('waits until everything has answered', () => {
    expect(decideFirstRun({ seen: null, introSeen: false, ...ready })).toBe('wait');
    expect(decideFirstRun({ seen: false, introSeen: null, ...ready })).toBe('wait');
    expect(
      decideFirstRun({ seen: false, introSeen: false, groupsReady: false, groupCount: 0 }),
    ).toBe('wait');
  });
  it('never shows twice', () => {
    expect(decideFirstRun({ seen: true, introSeen: false, ...ready })).toBe('skip');
  });
  it('marks existing accounts seen', () => {
    expect(
      decideFirstRun({ seen: false, introSeen: false, groupsReady: true, groupCount: 2 }),
    ).toBe('mark-existing');
    expect(decideFirstRun({ seen: false, introSeen: true, ...ready })).toBe('mark-existing');
  });
});

describe('routeForIntents', () => {
  it('uses the first shared intent picked', () => {
    expect(routeForIntents(['family', 'trip'], names)).toBe('/new-group?type=other&name=Family');
    expect(routeForIntents(['own', 'trip'], names)).toBe('/new-group?type=trip&name=Our%20trip');
    expect(routeForIntents(['couple'], names)).toBe('/new-group?type=couple&name=Us%20two');
    expect(routeForIntents(['flat'], names)).toBe('/new-group?type=home&name=Our%20flat');
  });
  it('opens Personal only for own money alone, Home for nothing', () => {
    expect(routeForIntents(['own'], names)).toBe('/me');
    expect(routeForIntents([], names)).toBe('/');
  });
});

describe('nameForField', () => {
  it('treats Guest as empty', () => {
    expect(nameForField('Guest')).toBe('');
    expect(nameForField(null)).toBe('');
    expect(nameForField(' Madan ')).toBe('Madan');
  });
});

describe('summariseHeard', () => {
  it('reads the sample sentence', () => {
    const heard = summariseHeard('Dinner 1,200 with Ravi and Asha');
    expect(heard?.amount).toBe(1200);
    expect(heard?.note).toBe('Dinner');
    expect(heard?.people).toBe(3);
  });
  it('gives null without an amount', () => {
    expect(summariseHeard('hello there')).toBeNull();
  });
});

describe('isInviteRoute', () => {
  it('keeps the join screen and short links', () => {
    expect(isInviteRoute('/join')).toBe(true);
    expect(isInviteRoute('/r/ABC123')).toBe(true);
    expect(isInviteRoute('/')).toBe(false);
    expect(isInviteRoute('/joined')).toBe(false);
  });
});
