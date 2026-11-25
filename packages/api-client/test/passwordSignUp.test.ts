/**
 * A new password account with email confirmation on gets no session back: a
 * code was mailed. The screen must then ask for that code (and verify it as a
 * 'signup' code); before this it simply stayed put and nothing happened.
 */

import { describe, expect, it, vi } from 'vitest';

import { createWavesClient } from '../src/index';

function clientFor(signUpSession: unknown) {
  const signUp = vi.fn().mockResolvedValue({ data: { session: signUpSession }, error: null });
  const signInWithPassword = vi
    .fn()
    .mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
  const verifyOtp = vi.fn().mockResolvedValue({ error: null });
  const supabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signUp,
      signInWithPassword,
      verifyOtp,
    },
  };
  const waves = createWavesClient({ supabase: supabase as never });
  return { waves, signUp, verifyOtp };
}

describe('withPassword', () => {
  it('says a code is needed when sign-up returns no session', async () => {
    const { waves } = clientFor(null);
    await expect(
      waves.withPassword('new@example.com', 'Long-enough-pass-42', 'sign_up'),
    ).resolves.toEqual({ confirmEmail: true });
  });

  it('needs no code when sign-up signs straight in', async () => {
    const { waves } = clientFor({ user: { id: 'u2' } });
    await expect(
      waves.withPassword('new@example.com', 'Long-enough-pass-42', 'sign_up'),
    ).resolves.toEqual({ confirmEmail: false });
  });

  it('needs no code for a sign-in', async () => {
    const { waves } = clientFor(null);
    await expect(
      waves.withPassword('old@example.com', 'Long-enough-pass-42', 'sign_in'),
    ).resolves.toEqual({ confirmEmail: false });
  });
});

describe('verifyEmailCode', () => {
  it('verifies a sign-up code as type signup', async () => {
    const { waves, verifyOtp } = clientFor(null);
    await waves.verifyEmailCode('new@example.com', '123456', 'signup');
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'new@example.com',
      token: '123456',
      type: 'signup',
    });
  });

  it('accepts a sign-up code at the sign-in step (unconfirmed account)', async () => {
    const { waves, verifyOtp } = clientFor(null);
    verifyOtp
      .mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } })
      .mockResolvedValueOnce({ error: null });
    await expect(waves.verifyEmailCode('new@example.com', '123456')).resolves.toBeUndefined();
    expect(verifyOtp).toHaveBeenLastCalledWith({
      email: 'new@example.com',
      token: '123456',
      type: 'signup',
    });
  });

  it('still fails when neither kind of code matches', async () => {
    const { waves, verifyOtp } = clientFor(null);
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    await expect(waves.verifyEmailCode('new@example.com', '000000')).rejects.toThrow();
  });
});
