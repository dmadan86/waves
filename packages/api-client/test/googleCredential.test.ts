/**
 * The guard on in-page Google sign-in.
 *
 * `signInWithIdToken` has no `linkIdentity` form, so running it for somebody
 * who already has a session does not add Google to that account — it signs
 * into a different one and abandons the first. For a guest that is the exact
 * loss ADR-006 exists to prevent, and nothing on screen would suggest it
 * happened. So the client refuses, and the caller falls back to the redirect,
 * which links correctly.
 *
 * The other half is the nonce. Google is handed its SHA-256 and Supabase the
 * raw value; if this passed the hash instead, every sign-in would fail at
 * Supabase with a mismatch and the bug would look like a provider outage.
 */

import { describe, expect, it, vi } from 'vitest';

import { createWavesClient, GOOGLE_CREDENTIAL_NEEDS_REDIRECT, WavesApiError } from '../src/index';

function clientFor(user: { id: string; is_anonymous?: boolean } | null) {
  const signInWithIdToken = vi.fn().mockResolvedValue({ error: null });
  const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
  const linkIdentity = vi.fn().mockResolvedValue({ error: null });
  const supabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: user ? { user } : null } }),
      signInWithIdToken,
      signInWithOAuth,
      linkIdentity,
    },
  };
  // The client wants a full SupabaseClient; this test drives four methods of it.
  const waves = createWavesClient({ supabase: supabase as never });
  return { waves, signInWithIdToken, signInWithOAuth, linkIdentity };
}

describe('signInWithGoogleCredential', () => {
  it('exchanges the token for nobody, and passes the nonce unhashed', async () => {
    const { waves, signInWithIdToken } = clientFor(null);

    await waves.signInWithGoogleCredential('id-token', 'raw-nonce');

    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'id-token',
      nonce: 'raw-nonce',
    });
  });

  it('refuses for a guest rather than replacing their account', async () => {
    const { waves, signInWithIdToken } = clientFor({ id: 'g1', is_anonymous: true });

    await expect(waves.signInWithGoogleCredential('id-token', 'raw-nonce')).rejects.toThrow(
      GOOGLE_CREDENTIAL_NEEDS_REDIRECT,
    );
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it('refuses for a signed-in user, because adding Google to them is a link', async () => {
    const { waves, signInWithIdToken } = clientFor({ id: 'u1', is_anonymous: false });

    await expect(waves.signInWithGoogleCredential('id-token', 'raw-nonce')).rejects.toThrow(
      GOOGLE_CREDENTIAL_NEEDS_REDIRECT,
    );
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it('reports a rejected token as an ordinary sign-in failure', async () => {
    const { waves, signInWithIdToken } = clientFor(null);
    signInWithIdToken.mockResolvedValueOnce({ error: { message: 'Invalid nonce' } });

    await expect(waves.signInWithGoogleCredential('id-token', 'raw-nonce')).rejects.toBeInstanceOf(
      WavesApiError,
    );
  });
});
