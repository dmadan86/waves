/**
 * A guest who signs in with a login that already has a Waves account switches
 * to that account, and the groups they joined as a guest come with them.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  clearAfterSignIn,
  guestJoins,
  MAX_REJOIN_ATTEMPTS,
  QUEUE_TTL_MS,
  lastProvider,
  queueJoinAfterSignIn,
  queueRejoin,
  rejoin,
  rememberGuestJoin,
  rememberProvider,
  requeueFailed,
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
    expect(takeAfterSignIn(store)).toEqual({ kind: 'rejoin', tokens: ['tok-a'], attempts: 0 });
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
    expect(takeAfterSignIn(store)).toEqual({ kind: 'join', token: 'tok-z', attempts: 0 });
  });

  it('drops a switch somebody abandoned, so the next person to sign in is not joined', () => {
    const store = memoryStore();
    rememberGuestJoin('guest-1', 'tok-a', store);
    queueRejoin('guest-1', store, 1_000);
    expect(takeAfterSignIn(store, 1_000 + QUEUE_TTL_MS + 1)).toBeNull();
    // Gone, not merely skipped.
    expect(store.data.has('waves.afterSignIn')).toBe(false);
  });

  it('can be taken back when the switch does not go ahead', () => {
    const store = memoryStore();
    queueJoinAfterSignIn('tok-z', store);
    clearAfterSignIn(store);
    expect(takeAfterSignIn(store)).toBeNull();
  });

  it('ignores a queue it does not recognise', () => {
    const store = memoryStore();
    const at = Date.now();
    store.data.set('waves.afterSignIn', JSON.stringify({ kind: 'rejoin', tokens: [42], at }));
    expect(takeAfterSignIn(store)).toBeNull();
    store.data.set('waves.afterSignIn', JSON.stringify({ kind: 'join', token: '', at }));
    expect(takeAfterSignIn(store)).toBeNull();
    // No timestamp: an old-format or hand-made entry is not trusted.
    store.data.set('waves.afterSignIn', JSON.stringify({ kind: 'join', token: 'tok' }));
    expect(takeAfterSignIn(store)).toBeNull();
  });
});

describe('joining the groups again', () => {
  it('joins every group and lands on the first', async () => {
    const accept = vi.fn(async (token: string) => ({ group: { id: `g-${token}` } }));
    await expect(rejoin(['a', 'b'], accept)).resolves.toEqual({ to: '/g/g-a', failed: [] });
    expect(accept).toHaveBeenCalledTimes(2);
  });

  it('carries on past a refused invite, and reports it', async () => {
    const onError = vi.fn();
    const accept = vi.fn(async (token: string) => {
      if (token === 'revoked') throw new Error('invite revoked');
      return { group: { id: `g-${token}` } };
    });

    await expect(rejoin(['revoked', 'ok'], accept, onError)).resolves.toEqual({
      to: '/g/g-ok',
      failed: ['revoked'],
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('does not land on a group still waiting on an admin', async () => {
    const accept = vi.fn(async () => ({ group: { id: 'g-1' }, pending: true }));
    await expect(rejoin(['a'], accept)).resolves.toEqual({ to: '/', failed: [] });
  });

  it('goes home when nothing took', async () => {
    const accept = vi.fn(async () => {
      throw new Error('gone');
    });
    await expect(rejoin(['a'], accept)).resolves.toEqual({ to: '/', failed: ['a'] });
  });

  it('keeps the groups that failed for another try, then gives up', () => {
    const store = memoryStore();
    requeueFailed(['a'], 0, store);
    expect(takeAfterSignIn(store)).toEqual({ kind: 'rejoin', tokens: ['a'], attempts: 1 });
    requeueFailed(['a'], MAX_REJOIN_ATTEMPTS - 1, store);
    expect(takeAfterSignIn(store)).toBeNull();
    requeueFailed([], 0, store);
    expect(takeAfterSignIn(store)).toBeNull();
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
