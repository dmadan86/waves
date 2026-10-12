/**
 * Joining a shared group needs an account (ADR-006 amendment, 2026-10-11).
 *
 * The invite screen's rules, without rendering it: what is offered to a
 * signed-out person, a guest and a real account; that no option anywhere is a
 * guest join; that the note left for the far side of a sign-in is single-use
 * and expires; and the route that brings the person back to finish the join.
 */
import { describe, expect, it, vi } from 'vitest';

import { isRemovedFromGroup, JoinGate, joinGate, shouldAutoJoin } from '@waves/core';

vi.mock('../src/lib/secureStorage', () => ({ secureAuthStorage: {} }));

const { joinActions, routeForJoinAction } = await import('../src/lib/joinActions');
const { makePendingInviteStore, PENDING_INVITE_TTL_MS, resumeRoute } =
  await import('../src/lib/pendingInvite');

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn(async (key: string) => data.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
}

describe('what the invite screen offers', () => {
  it('signed out: sign up and log in, nothing else', () => {
    const gate = joinGate({ signedIn: false, anonymous: false });
    expect(joinActions(gate)).toEqual(['sign_up', 'log_in']);
  });

  it('a guest: create an account, never a guest join', () => {
    const gate = joinGate({ signedIn: true, anonymous: true });
    expect(joinActions(gate)).toEqual(['create_account']);
  });

  it('a real account: join', () => {
    expect(joinActions(joinGate({ signedIn: true, anonymous: false }))).toEqual(['join']);
  });

  it('offers a join to nobody who is not a real account, and never a guest option', () => {
    for (const gate of [JoinGate.SignUpOrLogIn, JoinGate.UpgradeGuest]) {
      const actions = joinActions(gate);
      expect(actions).not.toContain('join');
      expect(actions.map(String).join(' ')).not.toMatch(/guest/);
    }
  });

  it('sends each account action to a screen that can finish it', () => {
    expect(routeForJoinAction('sign_up')).toBe('/sign-up');
    expect(routeForJoinAction('log_in')).toBe('/sign-in');
    // A guest is signed in, so the sign-in doors are closed to them; they
    // upgrade in place from the account screen.
    expect(routeForJoinAction('create_account')).toBe('/settings/account?reason=join');
  });
});

describe('the note that brings a person back to the invite', () => {
  it('is handed back once, then gone', async () => {
    const store = makePendingInviteStore(memory(), () => 1_000);
    await store.remember(' abc ');
    expect(await store.take()).toBe('abc');
    expect(await store.take()).toBeNull();
  });

  it('expires, so an abandoned sign-up is not applied to whoever signs in next', async () => {
    let now = 1_000;
    const storage = memory();
    const store = makePendingInviteStore(storage, () => now);
    await store.remember('abc');
    now += PENDING_INVITE_TTL_MS + 1;
    expect(await store.take()).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('survives garbage and a storage that throws, without failing a sign-in', async () => {
    const storage = memory();
    storage.data.set('waves.pendingInvite', '{not json');
    const store = makePendingInviteStore(storage);
    expect(await store.take()).toBeNull();

    const broken = makePendingInviteStore({
      getItem: async () => {
        throw new Error('keystore locked');
      },
      setItem: async () => {
        throw new Error('keystore locked');
      },
      removeItem: async () => {
        throw new Error('keystore locked');
      },
    });
    await expect(broken.remember('abc')).resolves.toBeUndefined();
    await expect(broken.take()).resolves.toBeNull();
  });

  it('can be asked about without being used up (so the sign-up sheet can hide the guest door)', async () => {
    let now = 1_000;
    const store = makePendingInviteStore(memory(), () => now);
    expect(await store.has()).toBe(false);
    await store.remember('abc');
    expect(await store.has()).toBe(true);
    expect(await store.has()).toBe(true);
    expect(await store.take()).toBe('abc');
    expect(await store.has()).toBe(false);
    await store.remember('abc');
    now += PENDING_INVITE_TTL_MS + 1;
    expect(await store.has()).toBe(false);
  });

  it('ignores a blank token', async () => {
    const storage = memory();
    await makePendingInviteStore(storage).remember('   ');
    expect(storage.data.size).toBe(0);
  });
});

describe('resume after login', () => {
  it('returns to the join screen marked as a resume, with the token intact', () => {
    expect(resumeRoute('a b/c')).toBe('/join?token=a%20b%2Fc&resume=1');
  });

  it('joins by itself for a real account that came back, but waits for a choice of name', () => {
    const base = {
      gate: JoinGate.Ready,
      resume: true,
      claimableCount: 0,
      attempted: false,
    };
    expect(shouldAutoJoin(base)).toBe(true);
    expect(shouldAutoJoin({ ...base, claimableCount: 1 })).toBe(false);
    // A guest who has not finished upgrading is not joined.
    expect(shouldAutoJoin({ ...base, gate: JoinGate.UpgradeGuest })).toBe(false);
  });
});

describe('removed from the group', () => {
  it('recognises the edge function refusal as readFunctionError words it', () => {
    expect(
      isRemovedFromGroup(
        new Error(
          'REMOVED_FROM_GROUP: You were removed from this group. Ask an admin for a new invite.',
        ),
      ),
    ).toBe(true);
    expect(
      isRemovedFromGroup(new Error('INVITE_INVALID: This invite link is no longer valid')),
    ).toBe(false);
  });

  it('has the message in all four languages', async () => {
    vi.doMock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
    const { STRINGS_BY_LANGUAGE } = await import('../src/i18n');
    expect(STRINGS_BY_LANGUAGE.en.misc.joinRemoved).toBe(
      'You were removed from this group. Ask an admin for a new invite.',
    );
    const texts = (['en', 'ta', 'hi', 'ar'] as const).map(
      (language) => STRINGS_BY_LANGUAGE[language].misc.joinRemoved,
    );
    expect(texts.every(Boolean)).toBe(true);
    expect(new Set(texts).size).toBe(4);
  });
});
