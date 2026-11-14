import { describe, expect, it } from 'vitest';

import { readSignInIntent } from '../src/lib/signInIntent';

describe('readSignInIntent', () => {
  it('reads the providers', () => {
    expect(readSignInIntent('?signin=google')).toEqual({ kind: 'google' });
    expect(readSignInIntent('?signin=apple')).toEqual({ kind: 'apple' });
  });
  it('prefills a valid email and drops anything else', () => {
    expect(readSignInIntent('?signin=email&email=a%40b.co')).toEqual({ kind: 'email', email: 'a@b.co' });
    expect(readSignInIntent('?signin=email&email=nope')).toEqual({ kind: 'email', email: '' });
    expect(readSignInIntent('?signin=email')).toEqual({ kind: 'email', email: '' });
  });
  it('ignores unknown or missing hints, including token-shaped ones', () => {
    expect(readSignInIntent('')).toBeNull();
    expect(readSignInIntent('?signin=password')).toBeNull();
    expect(readSignInIntent('?access_token=x&refresh_token=y')).toBeNull();
  });
});
