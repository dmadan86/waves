/**
 * The web join page needs an account (ADR-006 amendment, 2026-10-11).
 *
 * The page itself is a client component driven by effects, so the behaviour is
 * proven in a browser by `e2e/join-requires-account.spec.ts`. What can be pinned
 * without one: the decision it asks (`joinGate`, in @waves/core and tested
 * there), the strings it shows in every language, that the client no longer
 * has a way to mint a guest for a join, and that the sign-in queue brings a
 * person back to the invite and marks the return as a resume.
 */

import { describe, expect, it } from 'vitest';

import { createWavesClient } from '@waves/api-client';
import { JoinGate, joinGate, shouldAutoJoin } from '@waves/core';

import { fill, LANGUAGES, STRINGS_BY_LANGUAGE } from '../src/i18n';
import { queueJoinAfterSignIn, takeAfterSignIn, type KeyValue } from '../src/lib/guestSwitch';

function memory(): KeyValue {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('web join: strings', () => {
  it('has the sign-up, log-in and why copy in every language', () => {
    for (const language of LANGUAGES) {
      const join = STRINGS_BY_LANGUAGE[language].join;
      for (const key of ['signUpToJoin', 'logIn', 'guestUpgrade', 'accountRequired'] as const) {
        expect(join[key], `${language}.${key}`).toBeTruthy();
      }
      // The reason names the group, so it must carry the placeholder.
      expect(join.accountWhy, language).toContain('{group}');
      expect(join.guestWhy, language).toContain('{group}');
      expect(fill(join.accountWhy, { group: 'Goa' })).toContain('Goa');
    }
  });

  it('no longer promises a join without an account', () => {
    for (const language of LANGUAGES) {
      const text = JSON.stringify(STRINGS_BY_LANGUAGE[language].join);
      expect(text, language).not.toMatch(/no email, no password/i);
      expect(text, language).not.toMatch(/nothing to install/i);
    }
  });
});

describe('web join: no guest way in', () => {
  it('the client has no signInAsGuest', () => {
    const client = createWavesClient({
      supabase: {} as never,
      functionsUrl: 'https://f.example',
    } as never) as unknown as Record<string, unknown>;
    expect(client.signInAsGuest).toBeUndefined();
    expect(typeof client.acceptInvite).toBe('function');
  });

  it('gates signed-out and guest sessions, passes a real account', () => {
    expect(joinGate({ signedIn: false, anonymous: false })).toBe(JoinGate.SignUpOrLogIn);
    expect(joinGate({ signedIn: true, anonymous: true })).toBe(JoinGate.UpgradeGuest);
    expect(joinGate({ signedIn: true, anonymous: false })).toBe(JoinGate.Ready);
  });
});

describe('web join: back to the invite after signing in', () => {
  it('queues the token and hands it back once, then resumes the join automatically', () => {
    const store = memory();
    queueJoinAfterSignIn('tok-1', store, 1_000);
    const next = takeAfterSignIn(store, 2_000);
    expect(next).toMatchObject({ kind: 'join', token: 'tok-1' });
    expect(takeAfterSignIn(store, 2_001)).toBeNull();

    expect(
      shouldAutoJoin({
        gate: joinGate({ signedIn: true, anonymous: false }),
        resume: true,
        claimableCount: 0,
        attempted: false,
      }),
    ).toBe(true);
  });
});
