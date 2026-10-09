/**
 * The unread dot on a group row: the pure rules, the per-profile store, and the
 * per-group "newest from someone else" read over the mirror.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MirrorState } from '@waves/core';

import { newestActivityFromOthersByGroup } from '@/data/recentActivity';
import {
  groupsSeenKey,
  isGroupUnread,
  markGroupSeen,
  markSeenIn,
  parseGroupsSeen,
  resetGroupsSeenForTests,
  seedGroupsSeen,
  seedMissing,
  unreadGroupIds,
} from '@/lib/groupUnread';

describe('isGroupUnread', () => {
  it('lights for news from someone else since the last look', () => {
    expect(isGroupUnread(2_000, 1_000)).toBe(true);
  });

  it('stays dark once opened, or with no news', () => {
    expect(isGroupUnread(1_000, 1_000)).toBe(false);
    expect(isGroupUnread(500, 1_000)).toBe(false);
    expect(isGroupUnread(undefined, 1_000)).toBe(false);
  });

  it('never lights when the last look is unknown', () => {
    expect(isGroupUnread(2_000, null)).toBe(false);
    expect(isGroupUnread(2_000, undefined)).toBe(false);
  });
});

describe('unreadGroupIds', () => {
  const newest = new Map([
    ['g-a', 3_000],
    ['g-b', 1_000],
  ]);

  it('is the listed groups with news since their own last look', () => {
    const out = unreadGroupIds(['g-a', 'g-b', 'g-c'], newest, { 'g-a': 2_000, 'g-b': 2_000 });
    expect([...out]).toEqual(['g-a']);
  });

  it('is empty before the reads have loaded', () => {
    expect(unreadGroupIds(['g-a'], newest, null).size).toBe(0);
  });
});

describe('seedMissing', () => {
  it('starts never-seen groups as read, at now or their newest row', () => {
    const newest = new Map([['g-ahead', 9_000]]);
    expect(seedMissing(['g-old', 'g-new', 'g-ahead'], { 'g-old': 1 }, newest, 5_000)).toEqual({
      'g-new': 5_000,
      'g-ahead': 9_000,
    });
  });

  it('is null when every group already has a record', () => {
    expect(seedMissing(['g-a'], { 'g-a': 1 }, new Map(), 5_000)).toBeNull();
  });
});

describe('markSeenIn', () => {
  it('moves forward', () => {
    expect(markSeenIn({ 'g-a': 1_000 }, 'g-a', 2_000)).toEqual({ 'g-a': 2_000 });
  });

  it('never moves backwards, and keeps identity when nothing changes', () => {
    const seen = { 'g-a': 2_000 };
    expect(markSeenIn(seen, 'g-a', 1_000)).toBe(seen);
  });
});

describe('parseGroupsSeen', () => {
  it('reads a stored map and drops junk', () => {
    expect(parseGroupsSeen('{"g-a":5,"g-b":"x"}')).toEqual({ 'g-a': 5 });
    expect(parseGroupsSeen(null)).toEqual({});
    expect(parseGroupsSeen('not json')).toEqual({});
    expect(parseGroupsSeen('[1]')).toEqual({});
  });
});

describe('the per-profile store', () => {
  beforeEach(async () => {
    resetGroupsSeenForTests();
    await AsyncStorage.clear();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('keeps a mark made before the stored reads load, merged over them', async () => {
    await AsyncStorage.setItem(groupsSeenKey('p-me'), JSON.stringify({ 'g-a': 1, 'g-b': 7 }));
    markGroupSeen('p-me', 'g-a', 5);
    await settle();
    expect(parseGroupsSeen(await AsyncStorage.getItem(groupsSeenKey('p-me')))).toEqual({
      'g-a': 5,
      'g-b': 7,
    });
  });

  it('keeps each profile apart', async () => {
    markGroupSeen('p-me', 'g-a', 5);
    await settle();
    expect(await AsyncStorage.getItem(groupsSeenKey('p-other'))).toBeNull();
  });

  it('seeds only once the stored reads are in', async () => {
    seedGroupsSeen('p-me', ['g-a'], new Map(), 10);
    expect(await AsyncStorage.getItem(groupsSeenKey('p-me'))).toBeNull();
    markGroupSeen('p-me', 'g-x', 1); // starts the load
    await settle();
    seedGroupsSeen('p-me', ['g-a', 'g-x'], new Map(), 10);
    expect(parseGroupsSeen(await AsyncStorage.getItem(groupsSeenKey('p-me')))).toEqual({
      'g-x': 1,
      'g-a': 10,
    });
  });
});

describe('newestActivityFromOthersByGroup', () => {
  const mirror = {
    cursors: {},
    tables: {
      groups: {
        'g-goa': { id: 'g-goa' },
        'g-home': { id: 'g-home' },
        'g-gone': { id: 'g-gone', deleted_at: '2026-09-01T00:00:00.000Z' },
      },
      group_members: {
        'm-me': { id: 'm-me', group_id: 'g-goa', profile_id: 'p-me' },
        'm-me-home': { id: 'm-me-home', group_id: 'g-home', profile_id: 'p-me' },
        'm-ravi': { id: 'm-ravi', group_id: 'g-goa', profile_id: 'p-ravi' },
      },
      activity_log: {
        a1: {
          id: 'a1',
          group_id: 'g-goa',
          actor_member_id: 'm-ravi',
          created_at: '2026-09-02T00:00:00.000Z',
        },
        a2: {
          id: 'a2',
          group_id: 'g-goa',
          actor_member_id: 'm-me',
          created_at: '2026-09-05T00:00:00.000Z',
        },
        a3: {
          id: 'a3',
          group_id: 'g-goa',
          actor_member_id: 'm-ravi',
          created_at: '2026-09-03T00:00:00.000Z',
        },
        a4: {
          id: 'a4',
          group_id: 'g-home',
          actor_member_id: 'm-me-home',
          created_at: '2026-09-06T00:00:00.000Z',
        },
        a5: {
          id: 'a5',
          group_id: 'g-gone',
          actor_member_id: 'm-ravi',
          created_at: '2026-09-07T00:00:00.000Z',
        },
      },
    },
  } as unknown as MirrorState;

  it("is each group's newest row by someone else; my own rows and deleted groups never count", () => {
    const out = newestActivityFromOthersByGroup(mirror, 'p-me');
    expect(out.get('g-goa')).toBe(Date.parse('2026-09-03T00:00:00.000Z'));
    expect(out.has('g-home')).toBe(false);
    expect(out.has('g-gone')).toBe(false);
  });
});
