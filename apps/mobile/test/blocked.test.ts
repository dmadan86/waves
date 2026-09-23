/**
 * The block set, and the two pure questions every render site asks of it.
 *
 * Blocking is display-only: it must change the *name and face* a blocked person
 * shows under, and it must never be mistaken for the viewer themselves. These
 * check exactly that, plus the storage reducers that keep the set one-entry-per
 * -person and survive a corrupt stored value.
 */

import { describe, expect, it, vi } from 'vitest';

import { parseBlocked, removeBlocked, upsertBlocked, type BlockedUser } from '../src/data/blocked';
import { displayName, isBlockedMember } from '../src/data/types';
import type { MemberRow } from '../src/data/types';

// `useBlockedUsers` is run as a plain function: the external store is read by
// subscribing once and taking the snapshot, the memo and callbacks by identity.
// (vi.mock is hoisted above the imports.)
vi.mock('react', () => ({
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useSyncExternalStore: (subscribe: (cb: () => void) => () => void, get: () => unknown) => {
    subscribe(() => {})();
    return get();
  },
}));

const user = (id: string, name = id, avatarUrl: string | null = null): BlockedUser => ({
  id,
  name,
  avatarUrl,
});

const member = (over: Partial<MemberRow>): MemberRow =>
  ({
    id: 'm1',
    group_id: 'g1',
    profile_id: null,
    ghost_name: null,
    role: 'member',
    vpa: null,
    left_at: null,
    ...over,
  }) as MemberRow;

describe('the block reducers', () => {
  it('adds newest first', () => {
    const list = upsertBlocked(upsertBlocked([], user('a')), user('b'));
    expect(list.map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('never lists the same person twice, and refreshes their snapshot', () => {
    const list = upsertBlocked([user('a', 'Old')], user('a', 'New'));
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('New');
  });

  it('removes by id and leaves the rest', () => {
    expect(removeBlocked([user('a'), user('b')], 'a').map((entry) => entry.id)).toEqual(['b']);
  });

  it('reads back what was written, avatar and all', () => {
    const list = [user('a', 'Ada', 'https://cdn/a.png'), user('b', 'Bo')];
    expect(parseBlocked(JSON.stringify(list))).toEqual(list);
  });

  it('keeps a refreshed avatar on re-block', () => {
    const list = upsertBlocked([user('a', 'Ada', null)], user('a', 'Ada', 'https://cdn/a2.png'));
    expect(list).toHaveLength(1);
    expect(list[0]!.avatarUrl).toBe('https://cdn/a2.png');
  });

  it('treats a missing or corrupt store as nobody blocked', () => {
    expect(parseBlocked(null)).toEqual([]);
    expect(parseBlocked('not json')).toEqual([]);
    expect(parseBlocked('{"not":"an array"}')).toEqual([]);
  });

  it('drops entries with no id and fills a missing name', () => {
    const raw = JSON.stringify([
      { id: 'a' },
      { name: 'no id' },
      { id: 'b', name: 'Bo' },
      { id: 'c', name: 'Cy', avatarUrl: 123 },
    ]);
    expect(parseBlocked(raw)).toEqual([
      { id: 'a', name: '', avatarUrl: null },
      { id: 'b', name: 'Bo', avatarUrl: null },
      { id: 'c', name: 'Cy', avatarUrl: null },
    ]);
  });
});

describe('ghosting a blocked person', () => {
  const blocked = new Set(['p-blocked']);
  const real = member({ profile_id: 'p-blocked', profile: { display_name: 'Ravi' } as never });

  it('shows a blocked person by the anonymous name, not their real one', () => {
    expect(displayName(real, 'me', blocked, 'Someone')).toBe('Someone');
    expect(isBlockedMember(real, blocked)).toBe(true);
  });

  it('shows an unblocked person normally', () => {
    const other = member({ profile_id: 'p-ok', profile: { display_name: 'Priya' } as never });
    expect(displayName(other, 'me', blocked, 'Someone')).toBe('Priya');
    expect(isBlockedMember(other, blocked)).toBe(false);
  });

  it('never blocks the viewer against themselves', () => {
    const me = member({ profile_id: 'p-blocked', profile: { display_name: 'Ravi' } as never });
    // Even though this id is in the block set, it is the viewer's own id: "You"
    // wins, so you never see yourself as a ghost.
    expect(displayName(me, 'p-blocked', blocked, 'Someone')).toBe('You');
  });

  it('leaves a plain ghost (no profile) un-blockable', () => {
    const ghost = member({ profile_id: null, ghost_name: 'Sam' });
    expect(isBlockedMember(ghost, blocked)).toBe(false);
    expect(displayName(ghost, 'me', blocked, 'Someone')).toBe('Sam');
  });
});

describe('useBlockedUsers — the shared store', () => {
  /** A fresh module store (and a fresh in-memory AsyncStorage), seeded first. */
  async function load(stored?: string, failRead = false) {
    vi.resetModules();
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    if (stored !== undefined) await storage.setItem('blockedUsers:v1', stored);
    if (failRead) vi.spyOn(storage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    const mod = await import('../src/data/blocked');
    return { storage, mod };
  }

  /** Let the lazy hydration's promise chain settle. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('is not ready and empty before the stored list has loaded, then reads it', async () => {
    // Given a stored list with one person
    const { mod } = await load(JSON.stringify([user('p1', 'Ravi')]));
    // When first read, nothing has loaded yet
    const first = mod.useBlockedUsers();
    expect(first.ready).toBe(false);
    expect(first.blocked).toEqual([]);
    // Then once hydrated the list, the id set and the question all agree
    await settle();
    const after = mod.useBlockedUsers();
    expect(after.ready).toBe(true);
    expect(after.blocked).toEqual([user('p1', 'Ravi')]);
    expect(after.isBlocked('p1')).toBe(true);
    expect(after.isBlocked('p2')).toBe(false);
    expect(after.isBlocked(null)).toBe(false);
    expect(after.isBlocked(undefined)).toBe(false);
  });

  it('blocks and unblocks for every reader at once, and persists the list', async () => {
    const { mod, storage } = await load();
    await settle();
    // When one screen blocks somebody
    mod.useBlockedUsers().block(user('p9', 'Sam'));
    // Then a second reader sees it immediately, and it is written to storage
    expect(mod.useBlockedUsers().blockedIds.has('p9')).toBe(true);
    await settle();
    expect(JSON.parse((await storage.getItem('blockedUsers:v1')) ?? '[]')).toEqual([
      user('p9', 'Sam'),
    ]);
    // And unblocking removes it everywhere
    mod.useBlockedUsers().unblock('p9');
    expect(mod.useBlockedUsers().blocked).toEqual([]);
  });

  it('a block made while the first read is pending is not overwritten by it', async () => {
    const { mod } = await load(JSON.stringify([user('old')]));
    // Given the read has started but not finished, when somebody is blocked
    const hook = mod.useBlockedUsers();
    hook.block(user('new'));
    await settle();
    // Then the older stored snapshot does not replace the live list
    expect(mod.useBlockedUsers().blocked.map((u) => u.id)).toEqual(['new']);
    expect(mod.useBlockedUsers().ready).toBe(true);
  });

  it('a failed read leaves an empty, ready list rather than a crash', async () => {
    const { mod } = await load(JSON.stringify([user('p1')]), true);
    mod.useBlockedUsers();
    await settle();
    const after = mod.useBlockedUsers();
    expect(after.ready).toBe(true);
    expect(after.blocked).toEqual([]);
  });
});
