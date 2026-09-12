import { describe, expect, it } from 'vitest';

import { personAvatarPath } from '@/lib/personDetail';

describe('personAvatarPath', () => {
  it('does not sign a photo while the person is masked', () => {
    expect(personAvatarPath({ avatar_url: 'avatars/ravi.jpg', is_ghost: false }, true)).toBeNull();
  });

  it('does not sign a ghost avatar even if stale server data includes a path', () => {
    // Guests wear the ghost mark for users, riders, travellers and financers
    // until they claim an account. Signing a private avatar path for them would
    // leak identity before the UI has decided to show one.
    expect(personAvatarPath({ avatar_url: 'avatars/guest.jpg', is_ghost: true }, false)).toBeNull();
  });

  it('signs a real unmasked profile photo', () => {
    expect(personAvatarPath({ avatar_url: 'avatars/priya.jpg', is_ghost: false }, false)).toBe(
      'avatars/priya.jpg',
    );
  });

  it('returns null when there is no profile or no photo', () => {
    expect(personAvatarPath(null, false)).toBeNull();
    expect(personAvatarPath({ avatar_url: null, is_ghost: false }, false)).toBeNull();
  });
});
