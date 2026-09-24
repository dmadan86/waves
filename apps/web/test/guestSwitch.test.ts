/**
 * A guest who signs in with a login that already has a Waves account switches
 * to that account, and the groups they joined as a guest come with them.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  guestJoins,
  lastProvider,
  queueJoinAfterSignIn,
  queueRejoin,
  rejoin,
  rememberGuestJoin,
  rememberProvider,
  takeAfterSignIn,
  type KeyValue,
} from '../src/lib/guestSwitch';

function memoryStore(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('the groups a guest joined', () => {
  it('remembers each token once, for that guest only', () => {
    const store = memoryStore();
    rememberGuestJoin('guest-1', 'tok-a', store);
    rememberGuestJoin('guest-1', 'tok-b', store);
    rememberGuestJoin('guest-1', 'tok-a', store);

    expect(guestJoins('guest-1', store)).toEqual(['tok-a', 'tok-b']);
    // A list left behind by some other guest in this browser is never used.
    expect(guestJoins('guest-2', store)).toEqual([]);
  });

  it('starts over when a different guest joins', () => {
    const store = memoryStore();
    rememberGuestJoin('guest-1', 'tok-a', store);
    rememberGuestJoin('guest-2', 'tok-b', store);

    expect(guestJoins('guest-2', store)).toEqual(['tok-b']);
    expect(guestJoins('guest-1', store)).toEqual([]);
  });

  it('survives a corrupt or missing store', () => {
    const store = memoryStore();
    store.data.set('waves.guestJoins', '{not json');
    expect(guestJoins('guest-1', store)).toEqual([]);
    expect(guestJoins('guest-1', null)).toEqual([]);
    expect(() => rememberGuestJoin('guest-1', 'tok', null)).not.toThrow();
  });
});

describe('switching to the account they already have', () => {
  it('queues the guest’s groups for after the sign-in, once', () => {
    const store = memoryStore();
    rememberGuestJoin('guest-1', 'tok-a', store);
    queueRejoin('guest-1', store);

    expect(guestJoins('guest-1', store)).toEqual([]);
    expect(takeAfterSignIn(store)).toEqual({ kind: 'rejoin', tokens: ['tok-a'] });
    // Read once: a later sign-in does not join them all over again.
    expect(takeAfterSignIn(store)).toBeNull();
  });

  it('queues nothing for a guest who had joined nothing', () => {
    const store = memoryStore();
    queueRejoin('guest-1', store);
    expect(takeAfterSignIn(store)).toBeNull();
  });

  it('brings somebody who signed in first back to the join link', () => {
    const store = memoryStore();
    queueJoinAfterSignIn('tok-z', store);
    expect(takeAfterSignIn(store)).toEqual({ kind: 'join', token: 'tok-z' });
  });

  it('ignores a queue it does not recognise', () => {
    const store = memoryStore();
    store.data.set('waves.afterSignIn', JSON.stringify({ kind: 'rejoin', tokens: [42] }));
    expect(takeAfterSignIn(store)).toBeNull();
    store.data.set('waves.afterSignIn', JSON.stringify({ kind: 'join', token: '' }));
    expect(takeAfterSignIn(store)).toBeNull();
  });
});

describe('joining the groups again', () => {
  it('joins every group and lands on the first', async () => {
    const accept = vi.fn(async (token: string) => ({ group: { id: `g-${token}` } }));
    await expect(rejoin(['a', 'b'], accept)).resolves.toBe('/g/g-a');
    expect(accept).toHaveBeenCalledTimes(2);
  });

  it('carries on past a refused invite, and reports it', async () => {
    const onError = vi.fn();
    const accept = vi.fn(async (token: string) => {
      if (token === 'revoked') throw new Error('invite revoked');
      return { group: { id: `g-${token}` } };
    });

    await expect(rejoin(['revoked', 'ok'], accept, onError)).resolves.toBe('/g/g-ok');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('does not land on a group still waiting on an admin', async () => {
    const accept = vi.fn(async () => ({ group: { id: 'g-1' }, pending: true }));
    await expect(rejoin(['a'], accept)).resolves.toBe('/');
  });

  it('goes home when nothing took', async () => {
    const accept = vi.fn(async () => {
      throw new Error('gone');
    });
    await expect(rejoin(['a'], accept)).resolves.toBe('/');
  });
});

describe('which provider the answer names', () => {
  it('remembers Apple, and falls back to Google', () => {
    const store = memoryStore();
    expect(lastProvider(store)).toBe('google');
    rememberProvider('apple', store);
    expect(lastProvider(store)).toBe('apple');
    rememberProvider('google', store);
    expect(lastProvider(store)).toBe('google');
  });
});
