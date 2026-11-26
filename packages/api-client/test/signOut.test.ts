/** Signing out on one device must not revoke the account's other sessions. */
import { describe, expect, it, vi } from 'vitest';

import { createWavesClient } from '../src/index';

describe('signOut', () => {
  it('ends this device only (scope local), not every session', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const waves = createWavesClient({ supabase: { auth: { signOut } } as never });
    await waves.signOut();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
