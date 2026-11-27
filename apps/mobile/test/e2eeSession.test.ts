import { describe, expect, it } from 'vitest';

import { canAdoptLegacyOwner, ownerMismatch, SessionGeneration } from '../src/e2ee/session';

describe('E2EE account/session guards', () => {
  it('requires a wipe when stored ownership differs from the verified profile', () => {
    expect(ownerMismatch(null, 'profile-a')).toBe(false);
    expect(ownerMismatch('profile-a', 'profile-a')).toBe(false);
    expect(ownerMismatch('profile-a', 'profile-b')).toBe(true);
  });

  it('invalidates asynchronous work on stop and on a subsequent start', () => {
    const sessions = new SessionGeneration();
    const first = sessions.bump();
    expect(first()).toBe(true);
    sessions.invalidate();
    expect(first()).toBe(false);
    const second = sessions.bump();
    const third = sessions.bump();
    expect(second()).toBe(false);
    expect(third()).toBe(true);
  });

  it('adopts legacy E2EE only for the last recorded profile', () => {
    expect(canAdoptLegacyOwner('profile-a', 'profile-a')).toBe(true);
    expect(canAdoptLegacyOwner('profile-a', 'profile-b')).toBe(false);
    expect(canAdoptLegacyOwner(null, 'profile-a')).toBe(false);
  });
});
