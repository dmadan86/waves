/**
 * What a credential must not let somebody do.
 *
 * Every case here is an attack rather than a feature. A token is a signed
 * statement about who the bearer is, so the interesting questions are all about
 * what happens when the statement is edited: a flipped bit, a swapped prefix, a
 * borrowed tag, a different signing key. Getting any of those wrong is not a bug
 * a user would report — it is somebody else's ledger, quietly.
 */

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  CredentialKind,
  mintClientId,
  mintClientSecret,
  mintCredential,
  s256,
  sha256Hex,
  verifyCredential,
} from '../src/server/credentials';

const SECRET = 'a-test-signing-key-that-is-long-enough-to-be-real';
const OTHER_SECRET = 'a-different-signing-key-entirely-for-the-rotation-case';

describe('a minted credential', () => {
  it('round-trips the ids it was made with', () => {
    const id = randomUUID();
    const profileId = randomUUID();
    const minted = mintCredential(SECRET, CredentialKind.Personal, profileId, id);

    const read = verifyCredential(SECRET, minted.token);
    expect(read).toEqual({ kind: CredentialKind.Personal, id, profileId });
  });

  it('stores a hash, and the hash is not the token', () => {
    const minted = mintCredential(SECRET, CredentialKind.Access, randomUUID());
    expect(minted.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(minted.hash).not.toContain(minted.token);
    expect(minted.hash).toBe(sha256Hex(minted.token));
  });

  it('shows a prefix long enough to recognise and too short to use', () => {
    const minted = mintCredential(SECRET, CredentialKind.Personal, randomUUID());
    expect(minted.token.startsWith(minted.prefix)).toBe(true);
    expect(minted.prefix.length).toBeLessThan(minted.token.length / 2);
    // The prefix is what a list of tokens displays, so it must not verify.
    expect(verifyCredential(SECRET, minted.prefix)).toBeNull();
  });

  it('is unguessable from another one for the same person', () => {
    const profileId = randomUUID();
    const a = mintCredential(SECRET, CredentialKind.Personal, profileId);
    const b = mintCredential(SECRET, CredentialKind.Personal, profileId);
    expect(a.token).not.toBe(b.token);
    expect(a.id).not.toBe(b.id);
  });
});

describe('a credential somebody edited', () => {
  it('is refused when a single character of the blob changes', () => {
    const minted = mintCredential(SECRET, CredentialKind.Personal, randomUUID());
    // Flip one character in the middle of the payload, where the ids live.
    const at = minted.token.length - 30;
    const swapped = minted.token[at] === 'A' ? 'B' : 'A';
    const tampered = `${minted.token.slice(0, at)}${swapped}${minted.token.slice(at + 1)}`;
    expect(tampered).not.toBe(minted.token);
    expect(verifyCredential(SECRET, tampered)).toBeNull();
  });

  it('cannot be re-labelled as another kind by swapping its prefix', () => {
    // The whole point of signing the kind label: an access token and a refresh
    // token are the same 33 bytes under the same key, so without domain
    // separation "change wavs_at_ to wavs_rt_" would be a valid forgery and a
    // token would be usable at the endpoint it was never meant for.
    const access = mintCredential(SECRET, CredentialKind.Access, randomUUID());
    const asRefresh = access.token.replace('wavs_at_', 'wavs_rt_');
    expect(verifyCredential(SECRET, asRefresh)).toBeNull();
  });

  it('does not verify under a different signing key', () => {
    // Which is what makes rotating WAVES_API_TOKEN_SECRET an incident response:
    // every token issued under the old key stops working at once.
    const minted = mintCredential(SECRET, CredentialKind.Personal, randomUUID());
    expect(verifyCredential(OTHER_SECRET, minted.token)).toBeNull();
  });

  it('refuses anything that is not one of ours', () => {
    for (const junk of [
      '',
      'Bearer',
      'wavs_pat_',
      'wavs_pat_not-base64url-at-all!!',
      'wavs_xx_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      // A well-formed Supabase JWT: the right length family, the wrong scheme.
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
    ]) {
      expect(verifyCredential(SECRET, junk), junk).toBeNull();
    }
  });

  it('refuses a blob of the right shape with a made-up tag', () => {
    const minted = mintCredential(SECRET, CredentialKind.Personal, randomUUID());
    const blob = Buffer.from(minted.token.slice('wavs_pat_'.length), 'base64url');
    // Keep the body, replace the 16-byte tag with zeroes.
    const forged = Buffer.concat([blob.subarray(0, 33), Buffer.alloc(16)]);
    expect(verifyCredential(SECRET, `wavs_pat_${forged.toString('base64url')}`)).toBeNull();
  });
});

describe('the other secrets', () => {
  it('mints a client secret that is only ever stored as a hash', () => {
    const { secret, hash } = mintClientSecret();
    expect(secret).toMatch(/^wavs_cs_[A-Za-z0-9_-]{40,}$/);
    expect(hash).toBe(sha256Hex(secret));
    expect(mintClientSecret().secret).not.toBe(secret);
  });

  it('mints a client id in the shape the database constraint requires', () => {
    expect(mintClientId()).toMatch(/^wavs_app_[0-9a-f]{32}$/);
  });

  it('computes the PKCE S256 challenge the way RFC 7636 spells it', () => {
    // The worked example from RFC 7636 appendix B.
    expect(s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
