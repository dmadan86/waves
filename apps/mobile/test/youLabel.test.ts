import { afterEach, expect, it } from 'vitest';

import { actorName, displayName, setYouLabel } from '../src/data/types';

afterEach(() => setYouLabel('You'));

it('says "You" in the language on screen', () => {
  const member = { id: 'm1', profile_id: 'p1', ghost_name: null, profile: null } as never;
  const actor = { profile_id: 'p1', ghost_name: null, profile: null } as never;
  expect(displayName(member, 'p1')).toBe('You');
  setYouLabel('आप');
  expect(displayName(member, 'p1')).toBe('आप');
  expect(actorName(actor, 'p1')).toBe('आप');
});
